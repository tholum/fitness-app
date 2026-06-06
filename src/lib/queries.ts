/**
 * Path Warden — typed, server-side READ helpers.
 * Each awaits createClient() from "@/lib/supabase/server". All helpers tolerate
 * an empty / unseeded DB by returning null or [] rather than throwing.
 */

import { createClient } from "@/lib/supabase/server";
import { todayISO, startOfWeekISO, weekDates, toISODate } from "@/lib/format";
import type {
  GoalType,
  Profile,
  SessionLog,
  BlockCompletion,
  FeedPost,
  Reaction,
  BodyMetric,
  NutritionLog,
  WaterLog,
  PR,
  UserBadge,
  Badge,
  Crew,
  CrewRole,
  Program,
  ProgramDay,
  ProgramBlock,
  ProgramExercise,
  ProgramEnrollment,
  Exercise,
  Nudge,
  Tracker,
  TrackerType,
  TrackerLog,
} from "@/lib/types";

// ── Composite result shapes screens consume ──────────────────────────────
export interface TodaySession {
  log: SessionLog;
  blocks: BlockCompletion[];
}

export interface CrewMate {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  trainedToday: boolean;
}

export interface CrewToday {
  crew: Crew | null;
  members: CrewMate[];
  trainedCount: number;
  totalCount: number;
  weeklyGoal: number;
}

export interface FeedItem extends FeedPost {
  author: { display_name: string; avatar_url: string | null } | null;
  reactions: Reaction[];
}

export interface BodyToday {
  metric: BodyMetric | null;
  meals: NutritionLog[];
  water: WaterLog | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Progress {
  level: number;
  xp: number;
  streak: number;
  sessionsThisWeek: number;
  weeklyGoal: number;
  recentSessions: SessionLog[];
  prs: PR[];
  badges: Array<UserBadge & { badge: Badge | null }>;
}

/** A program block plus its ordered exercise rows. */
export type ProgramBlockWithExercises = ProgramBlock & {
  exercises: ProgramExercise[];
};

/** A program day plus its ordered blocks (each with their exercises). */
export type ProgramDayWithBlocks = ProgramDay & {
  blocks: ProgramBlockWithExercises[];
};

/** Full nested authoring tree for a single program. */
export interface ProgramTree {
  program: Program;
  days: ProgramDayWithBlocks[];
}

/** The active enrollment plus its program and resolved cursor day. */
export interface ActiveEnrollment {
  enrollment: ProgramEnrollment;
  program: Program;
  currentDay: ProgramDay | null;
}

/** The day Today should drive, plus its ordered blocks. */
export interface TodayDay {
  day: ProgramDay;
  blocks: ProgramBlock[];
  /** The enrolled program this day belongs to (convenience for the Today hero). */
  program: Program | null;
  /** Flattened `day.title` (convenience accessor for callers). */
  title: string;
  /** Flattened `day.est_minutes` (convenience accessor for callers). */
  estMinutes: number | null;
  /** Flattened `day.video_url` (convenience accessor for callers). */
  videoUrl: string | null;
}

/** A nudge with the sender's basic profile (null if the sender is gone). */
export type NudgeWithSender = Nudge & {
  from: { display_name: string; avatar_url: string | null } | null;
  /** Convenience: sender's display name, or a friendly fallback. */
  fromName: string;
};

/** A crew the user belongs to, plus their role and the crew's member count. */
export type MyCrew = Crew & {
  /** The current user's role in this crew. */
  role: CrewRole;
  /** Total members in the crew. */
  memberCount: number;
};

/** Resolve the current authenticated user id, or null if signed out. */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Resolve which crew to surface for a user: their `profiles.active_crew_id`
 * when set and still a valid membership, otherwise their first membership by
 * `joined_at`. Returns null when the user belongs to no crews.
 */
async function resolveActiveCrewId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uid: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_crew_id")
    .eq("id", uid)
    .maybeSingle();

  const preferred = (profile?.active_crew_id as string | null) ?? null;
  if (preferred) {
    // Confirm the pointer still references a crew the user belongs to.
    const { data: valid } = await supabase
      .from("crew_members")
      .select("crew_id")
      .eq("user_id", uid)
      .eq("crew_id", preferred)
      .maybeSingle();
    if (valid) return preferred;
  }

  // Fall back to the earliest-joined membership.
  const { data: first } = await supabase
    .from("crew_members")
    .select("crew_id")
    .eq("user_id", uid)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (first?.crew_id as string | null) ?? null;
}

// ── getProfile ────────────────────────────────────────────────────────────
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  // Return the raw row; appearance is normalized by ThemeProvider in the
  // (app) layout, so we no longer re-resolve it here.
  return data as Profile;
}

// ── getTodaySession ────────────────────────────────────────────────────────
export async function getTodaySession(userId?: string): Promise<TodaySession | null> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return null;

  const { data: log, error } = await supabase
    .from("session_logs")
    .select("*")
    .eq("user_id", uid)
    .eq("date", todayISO())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !log) return null;

  const { data: blocks } = await supabase
    .from("block_completions")
    .select("*")
    .eq("session_log_id", log.id)
    .order("order", { ascending: true });

  return { log: log as SessionLog, blocks: (blocks ?? []) as BlockCompletion[] };
}

// ── getCrewToday ───────────────────────────────────────────────────────────
export async function getCrewToday(userId?: string): Promise<CrewToday> {
  const empty: CrewToday = {
    crew: null,
    members: [],
    trainedCount: 0,
    totalCount: 0,
    weeklyGoal: 0,
  };
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return empty;

  // Honor the user's active-crew pointer; fall back to first membership.
  const crewId = await resolveActiveCrewId(supabase, uid);
  if (!crewId) return empty;

  const { data: crew } = await supabase
    .from("crews")
    .select("*")
    .eq("id", crewId)
    .maybeSingle();

  const { data: rows } = await supabase
    .from("crew_members")
    .select("user_id, profiles ( display_name, avatar_url )")
    .eq("crew_id", crewId);

  // The untyped Supabase client infers an embedded relation as an array; we
  // know `profiles` is a single row here, so reshape via `unknown`.
  const memberRows = (rows ?? []) as unknown as Array<{
    user_id: string;
    profiles: { display_name: string; avatar_url: string | null } | null;
  }>;
  const memberIds = memberRows.map((r) => r.user_id);

  // Who has a completed session today?
  let trainedIds = new Set<string>();
  if (memberIds.length) {
    const { data: trained } = await supabase
      .from("session_logs")
      .select("user_id")
      .in("user_id", memberIds)
      .eq("date", todayISO())
      .eq("completed", true);
    trainedIds = new Set((trained ?? []).map((t) => t.user_id as string));
  }

  const members: CrewMate[] = memberRows.map((r) => ({
    user_id: r.user_id,
    display_name: r.profiles?.display_name ?? "Athlete",
    avatar_url: r.profiles?.avatar_url ?? null,
    trainedToday: trainedIds.has(r.user_id),
  }));

  return {
    crew: (crew as Crew) ?? null,
    members,
    trainedCount: trainedIds.size,
    totalCount: members.length,
    weeklyGoal: (crew as Crew)?.weekly_goal ?? 0,
  };
}

// ── getFeed ────────────────────────────────────────────────────────────────
export async function getFeed(crewId: string, limit = 30): Promise<FeedItem[]> {
  if (!crewId) return [];
  const supabase = await createClient();

  const { data: posts, error } = await supabase
    .from("feed_posts")
    .select("*, author:profiles!feed_posts_user_id_fkey ( display_name, avatar_url )")
    .eq("crew_id", crewId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !posts?.length) return [];

  const ids = posts.map((p) => p.id as string);
  const { data: reactions } = await supabase
    .from("reactions")
    .select("*")
    .in("post_id", ids);

  const byPost = new Map<string, Reaction[]>();
  for (const r of (reactions ?? []) as Reaction[]) {
    const list = byPost.get(r.post_id) ?? [];
    list.push(r);
    byPost.set(r.post_id, list);
  }

  return posts.map((p) => {
    const { author, ...rest } = p as FeedPost & {
      author: { display_name: string; avatar_url: string | null } | null;
    };
    return {
      ...(rest as FeedPost),
      author: author ?? null,
      reactions: byPost.get(p.id as string) ?? [],
    };
  });
}

// ── getBodyToday ───────────────────────────────────────────────────────────
export async function getBodyToday(userId?: string): Promise<BodyToday> {
  const empty: BodyToday = {
    metric: null,
    meals: [],
    water: null,
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  };
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return empty;

  const date = todayISO();

  const [{ data: metric }, { data: meals }, { data: water }] = await Promise.all([
    supabase.from("body_metrics").select("*").eq("user_id", uid).eq("date", date).maybeSingle(),
    supabase.from("nutrition_logs").select("*").eq("user_id", uid).eq("date", date),
    supabase.from("water_logs").select("*").eq("user_id", uid).eq("date", date).maybeSingle(),
  ]);

  const mealList = (meals ?? []) as NutritionLog[];
  const totals = mealList.reduce(
    (acc, m) => {
      acc.kcal += m.kcal ?? 0;
      acc.protein += m.protein ?? 0;
      acc.carbs += m.carbs ?? 0;
      acc.fat += m.fat ?? 0;
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return {
    metric: (metric as BodyMetric) ?? null,
    meals: mealList,
    water: (water as WaterLog) ?? null,
    ...totals,
  };
}

// ── getProgress ────────────────────────────────────────────────────────────
export async function getProgress(userId?: string): Promise<Progress> {
  const empty: Progress = {
    level: 1,
    xp: 0,
    streak: 0,
    sessionsThisWeek: 0,
    weeklyGoal: 0,
    recentSessions: [],
    prs: [],
    badges: [],
  };
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return empty;

  const { data: profile } = await supabase
    .from("profiles")
    .select("level, xp, streak_count")
    .eq("id", uid)
    .maybeSingle();

  const weekStart = startOfWeekISO();

  // Honor the active-crew pointer (falls back to first membership) for the goal.
  const crewId = await resolveActiveCrewId(supabase, uid);

  const [{ data: weekSessions }, { data: recent }, { data: prs }, { data: badges }, { data: crew }] =
    await Promise.all([
      supabase
        .from("session_logs")
        .select("id")
        .eq("user_id", uid)
        .eq("completed", true)
        .gte("date", weekStart),
      supabase
        .from("session_logs")
        .select("*")
        .eq("user_id", uid)
        .eq("completed", true)
        .order("date", { ascending: false })
        .limit(20),
      supabase
        .from("prs")
        .select("*")
        .eq("user_id", uid)
        .order("achieved_on", { ascending: false })
        .limit(20),
      supabase
        .from("user_badges")
        .select("*, badge:badges ( key, name, emoji, description )")
        .eq("user_id", uid)
        .order("earned_on", { ascending: false }),
      crewId
        ? supabase.from("crews").select("weekly_goal").eq("id", crewId).maybeSingle()
        : Promise.resolve({ data: null as { weekly_goal: number } | null }),
    ]);

  const weeklyGoal = crew?.weekly_goal ?? 0;

  return {
    level: profile?.level ?? 1,
    xp: profile?.xp ?? 0,
    streak: profile?.streak_count ?? 0,
    sessionsThisWeek: (weekSessions ?? []).length,
    weeklyGoal,
    recentSessions: (recent ?? []) as SessionLog[],
    prs: (prs ?? []) as PR[],
    badges: (badges ?? []) as Array<UserBadge & { badge: Badge | null }>,
  };
}

// ════════════════════════════════════════════════════════════════════════
// PROGRAM AUTHORING / LIBRARY (0002)
// ════════════════════════════════════════════════════════════════════════

/** Sort comparator: program days by phase → week → day → order. */
function byDayOrder(a: ProgramDay, b: ProgramDay): number {
  return (
    a.phase - b.phase ||
    a.week - b.week ||
    a.day - b.day ||
    a.order - b.order
  );
}

// ── listMyPrograms ──────────────────────────────────────────────────────────
/** Programs owned by the current user (newest first). */
export async function listMyPrograms(): Promise<Program[]> {
  const supabase = await createClient();
  const uid = await currentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("owner_id", uid)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as Program[];
}

// ── listPublicPrograms ──────────────────────────────────────────────────────
/** Public/template programs (e.g. the seeded MTNTOUGH plan) to fork or follow. */
export async function listPublicPrograms(): Promise<Program[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as Program[];
}

// ── getProgram ──────────────────────────────────────────────────────────────
/** A single program by id (RLS limits this to public-or-owned), or null. */
export async function getProgram(id: string): Promise<Program | null> {
  if (!id) return null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Program;
}

// ── getProgramDays ──────────────────────────────────────────────────────────
/** A program's days, ordered phase → week → day → order. */
export async function getProgramDays(programId: string): Promise<ProgramDay[]> {
  if (!programId) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_days")
    .select("*")
    .eq("program_id", programId)
    .order("phase", { ascending: true })
    .order("week", { ascending: true })
    .order("day", { ascending: true })
    .order("order", { ascending: true });
  if (error || !data) return [];
  return data as ProgramDay[];
}

// ── getProgramTree ──────────────────────────────────────────────────────────
/**
 * Full nested authoring tree for a program: days (ordered phase→week→day→order)
 * → blocks (ordered) → exercises (ordered). Returns null if the program is not
 * visible/found. Tolerates empty days/blocks (returns empty arrays).
 */
export async function getProgramTree(programId: string): Promise<ProgramTree | null> {
  if (!programId) return null;
  const supabase = await createClient();

  const program = await getProgram(programId);
  if (!program) return null;

  const days = await getProgramDays(programId);
  if (!days.length) return { program, days: [] };

  const dayIds = days.map((d) => d.id);
  const { data: blockRows } = await supabase
    .from("program_blocks")
    .select("*")
    .in("program_day_id", dayIds)
    .order("order", { ascending: true });
  const blocks = (blockRows ?? []) as ProgramBlock[];

  const blockIds = blocks.map((b) => b.id);
  let exercises: ProgramExercise[] = [];
  if (blockIds.length) {
    const { data: exRows } = await supabase
      .from("program_exercises")
      .select("*")
      .in("program_block_id", blockIds)
      .order("order", { ascending: true });
    exercises = (exRows ?? []) as ProgramExercise[];
  }

  // Group children under parents, preserving the queried order.
  const exByBlock = new Map<string, ProgramExercise[]>();
  for (const ex of exercises) {
    const list = exByBlock.get(ex.program_block_id) ?? [];
    list.push(ex);
    exByBlock.set(ex.program_block_id, list);
  }

  const blocksByDay = new Map<string, ProgramBlockWithExercises[]>();
  for (const b of blocks) {
    const list = blocksByDay.get(b.program_day_id) ?? [];
    list.push({ ...b, exercises: exByBlock.get(b.id) ?? [] });
    blocksByDay.set(b.program_day_id, list);
  }

  const tree: ProgramDayWithBlocks[] = [...days]
    .sort(byDayOrder)
    .map((d) => ({ ...d, blocks: blocksByDay.get(d.id) ?? [] }));

  return { program, days: tree };
}

// ── getActiveEnrollment ─────────────────────────────────────────────────────
/**
 * The current user's single active enrollment, with its program and the
 * resolved cursor day (the row pointed to by `current_day_id`, or null).
 */
export async function getActiveEnrollment(userId?: string): Promise<ActiveEnrollment | null> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return null;

  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select("*")
    .eq("user_id", uid)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return null;

  const program = await getProgram((enrollment as ProgramEnrollment).program_id);
  if (!program) return null;

  let currentDay: ProgramDay | null = null;
  const cursor = (enrollment as ProgramEnrollment).current_day_id;
  if (cursor) {
    const { data: day } = await supabase
      .from("program_days")
      .select("*")
      .eq("id", cursor)
      .maybeSingle();
    currentDay = (day as ProgramDay) ?? null;
  }

  return { enrollment: enrollment as ProgramEnrollment, program, currentDay };
}

// ── resolveTodayDay ─────────────────────────────────────────────────────────
/**
 * The program day that Today should drive for the current user: the active
 * enrollment's `current_day_id`, falling back to the lowest-ordered day of the
 * enrolled program when the cursor is null. Returns the day plus its ordered
 * blocks, or null if the user has no active enrollment / the program has no days.
 */
export async function resolveTodayDay(userId?: string): Promise<TodayDay | null> {
  const supabase = await createClient();

  const active = await getActiveEnrollment(userId);
  if (!active) return null;

  let day = active.currentDay;
  if (!day) {
    // Fall back to the first day (phase→week→day→order) of the program.
    const days = await getProgramDays(active.program.id);
    day = days[0] ?? null;
  }
  if (!day) return null;

  const { data: blocks } = await supabase
    .from("program_blocks")
    .select("*")
    .eq("program_day_id", day.id)
    .order("order", { ascending: true });

  return {
    day,
    blocks: (blocks ?? []) as ProgramBlock[],
    program: active.program,
    title: day.title,
    estMinutes: day.est_minutes,
    videoUrl: day.video_url,
  };
}

// ── getTrainingScheduleToday ─────────────────────────────────────────────────
/** Whether today is a scheduled training day, and the streak-relevant context. */
export interface TrainingScheduleToday {
  /** Profile goal mode (0009): 'days' = specific weekdays, 'count' = weekly #. */
  goalType: GoalType;
  /** Scheduled weekdays as Postgres dow (0=Sun..6=Sat); meaningful for 'days'. */
  trainingDays: number[];
  /** Weekly session target; meaningful for 'count'. */
  weeklyTarget: number;
  /**
   * True when today counts as a training day for streak purposes:
   *   • 'days'  → today's weekday is in trainingDays (a rest day is false).
   *   • 'count' → always true (any day can count toward the weekly target).
   */
  isTrainingDay: boolean;
  /** True only in 'days' mode when today is NOT a scheduled day (a rest day). */
  isRestDay: boolean;
}

/**
 * Resolve whether TODAY is a scheduled training day, from the profile training
 * goal (0009 — the canonical schedule that drives the streak). The Today screen
 * uses this to tell the user "rest day — nothing breaks your streak" vs. a
 * scheduled session. Mirrors recompute_my_stats() semantics exactly: in 'days'
 * mode a non-scheduled day is a rest day (never counts against the streak); in
 * 'count' mode there are no rest days (any day can advance the weekly target).
 */
export async function getTrainingScheduleToday(
  userId?: string,
): Promise<TrainingScheduleToday | null> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return null;

  const { data } = await supabase
    .from("profiles")
    .select("goal_type, training_days, weekly_target")
    .eq("id", uid)
    .maybeSingle();
  if (!data) return null;

  const goalType: GoalType = data.goal_type === "count" ? "count" : "days";
  // An empty schedule is normalized to "every day" (matches 0009 setter).
  const raw = Array.isArray(data.training_days) ? (data.training_days as number[]) : [];
  const trainingDays = raw.length ? raw : [0, 1, 2, 3, 4, 5, 6];
  const weeklyTarget = typeof data.weekly_target === "number" ? data.weekly_target : 3;

  const todayDow = new Date().getDay();
  const scheduledToday = trainingDays.includes(todayDow);
  const isTrainingDay = goalType === "count" ? true : scheduledToday;
  const isRestDay = goalType === "days" && !scheduledToday;

  return { goalType, trainingDays, weeklyTarget, isTrainingDay, isRestDay };
}

// ── listExercises ───────────────────────────────────────────────────────────
/** Exercise library visible to the user (public or owned), ordered by name. */
export async function listExercises(): Promise<Exercise[]> {
  const supabase = await createClient();
  // RLS already limits rows to public-or-owned; no extra filter needed.
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data as Exercise[];
}

// ════════════════════════════════════════════════════════════════════════
// CREW SWITCHING + NUDGES (0002)
// ════════════════════════════════════════════════════════════════════════

// ── listMyCrews ─────────────────────────────────────────────────────────────
/**
 * Every crew the current user belongs to (via crew_members), ordered by
 * joined_at, each enriched with the user's role and the crew's member count —
 * the shape the crew switcher consumes.
 */
export async function listMyCrews(userId?: string): Promise<MyCrew[]> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return [];

  const { data, error } = await supabase
    .from("crew_members")
    .select("role, joined_at, crews (*)")
    .eq("user_id", uid)
    .order("joined_at", { ascending: true });
  if (error || !data) return [];

  // The embedded `crews` relation is a single row per membership.
  const rows = data as unknown as Array<{
    role: CrewRole;
    crews: Crew | null;
  }>;
  const memberships = rows.filter(
    (r): r is { role: CrewRole; crews: Crew } => r.crews != null,
  );
  if (!memberships.length) return [];

  // Count members per crew (RLS lets a member read fellow members).
  const crewIds = memberships.map((m) => m.crews.id);
  const { data: counts } = await supabase
    .from("crew_members")
    .select("crew_id")
    .in("crew_id", crewIds);
  const memberCount = new Map<string, number>();
  for (const row of (counts ?? []) as Array<{ crew_id: string }>) {
    memberCount.set(row.crew_id, (memberCount.get(row.crew_id) ?? 0) + 1);
  }

  return memberships.map((m) => ({
    ...m.crews,
    role: m.role,
    memberCount: memberCount.get(m.crews.id) ?? 1,
  }));
}

// ── getNudges ───────────────────────────────────────────────────────────────
/** Unseen nudges addressed to the current user, with the sender's profile. */
export async function getNudges(userId?: string): Promise<NudgeWithSender[]> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return [];

  const { data, error } = await supabase
    .from("nudges")
    .select("*, from:profiles!nudges_from_user_fkey ( display_name, avatar_url )")
    .eq("to_user", uid)
    .eq("seen", false)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  return data.map((n) => {
    const { from, ...rest } = n as Nudge & {
      from: { display_name: string; avatar_url: string | null } | null;
    };
    return {
      ...(rest as Nudge),
      from: from ?? null,
      fromName: from?.display_name ?? "A crewmate",
    };
  });
}

// ── getUnseenNudgeCount ─────────────────────────────────────────────────────
/** Count of unseen nudges to the current user (0 when signed out / none). */
export async function getUnseenNudgeCount(userId?: string): Promise<number> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return 0;

  const { count, error } = await supabase
    .from("nudges")
    .select("id", { count: "exact", head: true })
    .eq("to_user", uid)
    .eq("seen", false);
  if (error) return 0;
  return count ?? 0;
}

// ════════════════════════════════════════════════════════════════════════
// TRACKERS / GOALS (0010)
// ════════════════════════════════════════════════════════════════════════

/**
 * This-week progress for a single tracker, computed from the RIGHT source per
 * type (see getWeeklyProgress). A presentational shape consumed by the
 * WeeklyProgress component.
 *
 *   done    — progress so far this week (a count for times_per_week /
 *             specific_weekdays / daily_binary; an accumulated amount for
 *             amount_per_week).
 *   target  — the weekly target (count or amount). 0 when none is set.
 *   unit    — display unit for amount_per_week (e.g. "min"); null otherwise.
 *   perDay  — Mon→Sun (7 entries, index 0 = Monday) value for the current
 *             week. A boolean for binary/weekday cadences, a number for amounts.
 *   streak  — completed-period streak (weeks for times_per_week /
 *             amount_per_week; days for daily_binary; scheduled-days for
 *             specific_weekdays). 0 in Phase 1 where not yet computed.
 *   scheduledWeekdays — for specific_weekdays: committed weekdays as Mon→Sun
 *             booleans (index 0 = Monday); null for other cadences.
 */
export interface WeeklyProgress {
  done: number;
  target: number;
  unit: string | null;
  /** 7 entries, Monday-first (index 0 = Mon, 6 = Sun). */
  perDay: Array<boolean | number>;
  streak: number;
  /** Mon-first committed weekdays; only set for specific_weekdays. */
  scheduledWeekdays: boolean[] | null;
}

/** All non-archived trackers for a user, ordered for display. */
export async function getTrackers(userId?: string): Promise<Tracker[]> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return [];

  const { data, error } = await supabase
    .from("trackers")
    .select("*")
    .eq("user_id", uid)
    .eq("archived", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as Tracker[];
}

/**
 * Map a Postgres dow (0=Sun..6=Sat) to a Mon-first index (0=Mon..6=Sun), so
 * the perDay / scheduledWeekdays arrays line up with the Mon-first UI strip.
 */
function dowToMonIndex(dow: number): number {
  return (dow + 6) % 7;
}

/**
 * Compute THIS week's progress for a tracker from the correct source:
 *
 *   bible / custom → tracker_logs (own per-day entries).
 *   diet           → nutrition_logs, summed for the week, vs. a macro target
 *                    from config (config.targetKey picks the macro; defaults to
 *                    kcal). amount_per_week semantics.
 *   exercise       → session_logs (completed), as a weekly session count.
 *
 * Streak is left at 0 here in Phase 1 except for the cheap weekday/daily cases;
 * the richer streak logic (mirroring recompute_my_stats) lands with the
 * per-type screens. Always returns a well-formed WeeklyProgress (never throws).
 */
export async function getWeeklyProgress(
  tracker: Tracker,
  userId?: string,
): Promise<WeeklyProgress> {
  const supabase = await createClient();
  const uid = userId ?? tracker.user_id ?? (await currentUserId());

  const week = weekDates(); // 7 ISO dates, Monday-first
  const weekStart = week[0];
  const weekEnd = week[6];

  const target =
    tracker.cadence_type === "amount_per_week"
      ? tracker.weekly_target_amount ?? 0
      : tracker.cadence_type === "times_per_week"
        ? tracker.weekly_target_count ?? 0
        : // specific_weekdays → target is the # of committed days;
          // daily_binary → 7 (every day).
          tracker.cadence_type === "specific_weekdays"
          ? (tracker.scheduled_weekdays ?? []).length
          : 7;

  const unit =
    tracker.cadence_type === "amount_per_week" ? tracker.unit ?? null : null;

  const scheduledWeekdays =
    tracker.cadence_type === "specific_weekdays"
      ? (() => {
          const set = new Set(tracker.scheduled_weekdays ?? []);
          const arr = Array(7).fill(false) as boolean[];
          for (const dow of set) arr[dowToMonIndex(dow)] = true;
          return arr;
        })()
      : null;

  const empty: WeeklyProgress = {
    done: 0,
    target,
    unit,
    perDay: Array(7).fill(tracker.cadence_type === "amount_per_week" ? 0 : false),
    streak: 0,
    scheduledWeekdays,
  };
  if (!uid) return empty;

  // ── DIET → nutrition_logs vs. config macro target ──────────────────────
  if (tracker.type === "diet") {
    const cfg = (tracker.config ?? {}) as Record<string, unknown>;
    const macro =
      typeof cfg.targetKey === "string" &&
      ["kcal", "protein", "carbs", "fat"].includes(cfg.targetKey)
        ? (cfg.targetKey as "kcal" | "protein" | "carbs" | "fat")
        : "kcal";
    const dietTarget =
      typeof cfg.weeklyTarget === "number"
        ? cfg.weeklyTarget
        : typeof cfg.dailyTarget === "number"
          ? cfg.dailyTarget * 7
          : target;

    const { data: rows } = await supabase
      .from("nutrition_logs")
      .select(`date, ${macro}`)
      .eq("user_id", uid)
      .gte("date", weekStart)
      .lte("date", weekEnd);

    const perDay = Array(7).fill(0) as number[];
    let done = 0;
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const v = Number(r[macro] ?? 0) || 0;
      const idx = week.indexOf(r.date as string);
      if (idx >= 0) perDay[idx] += v;
      done += v;
    }
    return {
      done,
      target: dietTarget,
      unit: macro === "kcal" ? "kcal" : "g",
      perDay,
      streak: 0,
      scheduledWeekdays: null,
    };
  }

  // ── EXERCISE → completed session_logs as a weekly session count ─────────
  if (tracker.type === "exercise") {
    const { data: rows } = await supabase
      .from("session_logs")
      .select("date")
      .eq("user_id", uid)
      .eq("completed", true)
      .gte("date", weekStart)
      .lte("date", weekEnd);

    const perDay = Array(7).fill(false) as boolean[];
    const days = new Set<string>();
    for (const r of (rows ?? []) as Array<{ date: string }>) {
      days.add(r.date);
      const idx = week.indexOf(r.date);
      if (idx >= 0) perDay[idx] = true;
    }
    return {
      done: days.size,
      target,
      unit: null,
      perDay,
      streak: 0,
      scheduledWeekdays,
    };
  }

  // ── BIBLE / CUSTOM → tracker_logs ───────────────────────────────────────
  const { data: rows } = await supabase
    .from("tracker_logs")
    .select("date, value")
    .eq("tracker_id", tracker.id)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const isAmount = tracker.cadence_type === "amount_per_week";
  const perDay = Array(7).fill(isAmount ? 0 : false) as Array<number | boolean>;
  let done = 0;
  for (const r of (rows ?? []) as Array<{ date: string; value: number }>) {
    const v = Number(r.value ?? 0) || 0;
    const idx = week.indexOf(r.date);
    if (isAmount) {
      if (idx >= 0) perDay[idx] = (perDay[idx] as number) + v;
      done += v;
    } else {
      if (idx >= 0) perDay[idx] = true;
      done += 1;
    }
  }

  return { done, target, unit, perDay, streak: 0, scheduledWeekdays };
}

/** Convenience: all of a user's trackers paired with this-week progress. */
export async function getTrackersWithProgress(
  userId?: string,
): Promise<Array<{ tracker: Tracker; progress: WeeklyProgress }>> {
  const uid = userId ?? (await currentUserId());
  if (!uid) return [];
  const trackers = await getTrackers(uid);
  return Promise.all(
    trackers.map(async (tracker) => ({
      tracker,
      progress: await getWeeklyProgress(tracker, uid),
    })),
  );
}

/**
 * The user's singleton bible tracker, or null if none has been created yet.
 * (Phase 3 first-class screen entry point.)
 */
export async function getBibleTracker(userId?: string): Promise<Tracker | null> {
  const supabase = await createClient();
  const uid = userId ?? (await currentUserId());
  if (!uid) return null;
  const { data, error } = await supabase
    .from("trackers")
    .select("*")
    .eq("user_id", uid)
    .eq("type", "bible")
    .eq("archived", false)
    .maybeSingle();
  if (error || !data) return null;
  return data as Tracker;
}

/**
 * The set of dates (ISO YYYY-MM-DD) a tracker has a log on, within the last
 * `lookbackDays` days (inclusive of today). Used to derive streaks for
 * tracker_logs-backed types (bible / custom) without a DB roundtrip per day.
 */
async function trackerLoggedDates(
  trackerId: string,
  lookbackDays = 400,
): Promise<Set<string>> {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const { data } = await supabase
    .from("tracker_logs")
    .select("date")
    .eq("tracker_id", trackerId)
    .gte("date", toISODate(since));
  return new Set((data ?? []).map((r) => r.date as string));
}

/**
 * Compute a tracker's current streak from its tracker_logs, honoring cadence:
 *
 *   • daily_binary      → consecutive distinct days ending today (or yesterday
 *                         if today isn't logged yet, so an unfinished today
 *                         doesn't zero a live streak). Mirrors the session
 *                         streak rule in actions.consecutiveDayStreak.
 *   • specific_weekdays → consecutive SCHEDULED days satisfied, walking
 *                         backwards and skipping non-scheduled days (rest days
 *                         never break the streak — same spirit as 0009 training
 *                         goals). Today only counts against the streak once it
 *                         is itself a scheduled day that has passed/now.
 *   • other cadences    → 0 here (richer per-period streaks are out of scope).
 *
 * Returns 0 when there are no logs or no schedule. Never throws.
 */
export async function getTrackerStreak(tracker: Tracker): Promise<number> {
  if (
    tracker.cadence_type !== "daily_binary" &&
    tracker.cadence_type !== "specific_weekdays"
  ) {
    return 0;
  }

  const logged = await trackerLoggedDates(tracker.id);
  if (logged.size === 0) return 0;

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (tracker.cadence_type === "daily_binary") {
    // Anchor on today if logged, else yesterday — so an unfinished today
    // doesn't break an otherwise-live streak.
    if (!logged.has(toISODate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!logged.has(toISODate(cursor))) return 0;
    }
    let streak = 0;
    while (logged.has(toISODate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // specific_weekdays — count satisfied scheduled days, skipping rest days.
  const scheduled = new Set(tracker.scheduled_weekdays ?? []);
  if (scheduled.size === 0) return 0;

  // If today is a scheduled day but isn't logged yet, don't penalize it: start
  // the walk from yesterday so a not-yet-done today is forgiven.
  if (scheduled.has(cursor.getDay()) && !logged.has(toISODate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  // Bounded walk (covers >1yr of weeks) — stop at the first missed scheduled day.
  for (let i = 0; i < 400; i++) {
    const dow = cursor.getDay();
    if (scheduled.has(dow)) {
      if (logged.has(toISODate(cursor))) {
        streak += 1;
      } else {
        break; // a scheduled day with no log breaks the streak
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ════════════════════════════════════════════════════════════════════════
// CREW GOALS (Phase 6 — social surfacing)
// ════════════════════════════════════════════════════════════════════════

/** One crew member's shared goal, with this-week progress, for the Crew screen. */
export interface CrewGoal {
  userId: string;
  trackerId: string;
  title: string;
  icon: string | null;
  type: TrackerType;
  done: number;
  target: number;
  unit: string | null;
  /** True when this week's target is met (or any progress when no target). */
  met: boolean;
}

/** Crew goals grouped by member id (only members with ≥1 shared goal appear). */
export interface CrewGoals {
  byUser: Map<string, CrewGoal[]>;
  /** Total shared goals across the crew this week. */
  total: number;
  /** How many of those goals have hit their weekly target. */
  metCount: number;
}

/**
 * Read every crew member's SHARED goals plus this week's progress, for the
 * crew screen's "Goals this week" surface. Reuses the foundation's
 * getWeeklyProgress per tracker so the math matches the dashboard exactly.
 *
 * RLS does the access control: trackers_select / tracker_logs_select already
 * expose a crew-mate's rows when the tracker is shared AND shares_crew() holds,
 * so a plain query over the member ids returns only what the viewer may see.
 * Tolerates an empty crew / unseeded DB (returns an empty grouping).
 */
export async function getCrewGoals(memberIds: string[]): Promise<CrewGoals> {
  const byUser = new Map<string, CrewGoal[]>();
  const empty: CrewGoals = { byUser, total: 0, metCount: 0 };
  if (!memberIds.length) return empty;

  const supabase = await createClient();

  // Shared, active trackers for all members (RLS filters to the viewer-visible
  // subset). Ordered for a stable, friendly read.
  const { data: rows } = await supabase
    .from("trackers")
    .select("*")
    .in("user_id", memberIds)
    .eq("archived", false)
    .eq("shared", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const trackers = (rows ?? []) as Tracker[];
  if (!trackers.length) return empty;

  // Compute this-week progress per tracker (same helper the dashboard uses).
  // Pass each tracker's owner so the right per-type source is queried.
  const goals = await Promise.all(
    trackers.map(async (t) => {
      const p = await getWeeklyProgress(t, t.user_id);
      const met = p.target > 0 ? p.done >= p.target : p.done > 0;
      return {
        userId: t.user_id,
        trackerId: t.id,
        title: t.title,
        icon: t.icon ?? null,
        type: t.type,
        done: p.done,
        target: p.target,
        unit: p.unit,
        met,
      } satisfies CrewGoal;
    }),
  );

  let total = 0;
  let metCount = 0;
  for (const g of goals) {
    const list = byUser.get(g.userId) ?? [];
    list.push(g);
    byUser.set(g.userId, list);
    total += 1;
    if (g.met) metCount += 1;
  }

  return { byUser, total, metCount };
}

// Re-export so screens can pull the tracker_logs row type alongside helpers.
export type { TrackerLog };
