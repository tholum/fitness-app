"use server";

/**
 * BASECAMP — server actions (mutations). Each uses the server Supabase client
 * (RLS enforces ownership) and revalidates the affected route(s).
 *
 * Conventions kept stable for callers:
 *  • ActionResult<T> envelope ({ ok, error?, data? })
 *  • requireUser() helper resolves { supabase, user }
 *  • revalidatePath(...) after every successful mutation
 *
 * The Supabase client here is the untyped @supabase/ssr client, so table /
 * column names are passed as strings and rows are cast via `as` — matching the
 * existing pattern in queries.ts (no generated DB types).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO, toISODate } from "@/lib/format";
import type { BlockType } from "@/lib/types";
// Appearance's typed/normalized shape is owned by ThemeProvider (gap 42); the
// `import type` is erased at compile time, so importing it into this server
// module does not cross the client/server boundary.
import type { Appearance } from "@/components/ThemeProvider";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Resolve the caller's active crew id. Prefers profiles.active_crew_id; falls
 * back to the earliest crew membership so feed posts still land somewhere for
 * users created before the active-crew pointer existed.
 */
async function resolveActiveCrewId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_crew_id")
    .eq("id", userId)
    .maybeSingle();
  const active = (profile as { active_crew_id: string | null } | null)?.active_crew_id ?? null;
  if (active) return active;

  const { data: membership } = await supabase
    .from("crew_members")
    .select("crew_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (membership as { crew_id: string } | null)?.crew_id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// SESSIONS
// ════════════════════════════════════════════════════════════════════════════

// ── completeSession ─────────────────────────────────────────────────────────
export interface CompleteSessionInput {
  /** Existing session log to complete, if one was already started. */
  sessionLogId?: string;
  programDayId?: string | null;
  title: string;
  durationMin?: number | null;
  rpe?: number | null;
  notes?: string | null;
  shared?: boolean;
  /** Block checklist to persist (replaces any existing for this session). */
  blocks?: Array<{ label: string; type?: BlockType | null; done: boolean; detail?: unknown }>;
  /** If true, also post to the user's active crew feed. */
  crewId?: string | null;
}

export async function completeSession(
  input: CompleteSessionInput,
): Promise<ActionResult<{ sessionLogId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const payload = {
    user_id: user.id,
    program_day_id: input.programDayId ?? null,
    title: input.title,
    date: todayISO(),
    completed: true,
    completed_at: new Date().toISOString(),
    duration_min: input.durationMin ?? null,
    rpe: input.rpe ?? null,
    notes: input.notes ?? null,
    shared: input.shared ?? true,
  };

  let sessionLogId = input.sessionLogId;
  if (sessionLogId) {
    const { error } = await supabase
      .from("session_logs")
      .update(payload)
      .eq("id", sessionLogId)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase
      .from("session_logs")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };
    sessionLogId = data.id as string;
  }

  if (input.blocks?.length && sessionLogId) {
    await supabase.from("block_completions").delete().eq("session_log_id", sessionLogId);
    const rows = input.blocks.map((b, i) => ({
      session_log_id: sessionLogId!,
      label: b.label,
      type: b.type ?? null,
      done: b.done,
      detail: b.detail ?? null,
      order: i,
    }));
    const { error } = await supabase.from("block_completions").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  if (input.shared !== false && input.crewId) {
    await supabase.from("feed_posts").insert({
      user_id: user.id,
      crew_id: input.crewId,
      kind: "session",
      ref_id: sessionLogId,
      body: input.title,
    });
    revalidatePath("/crew");
  }

  // ── Scheduler advance (gap 5) ──────────────────────────────────────────────
  // If this session is tied to a program day and the user has an active
  // enrollment, move the cursor to the next ordered day. Best-effort: a failure
  // here must not fail the completion.
  if (input.programDayId) {
    await advanceEnrollment(supabase, user.id, input.programDayId);
  }

  // ── Gamification (gap 39) ──────────────────────────────────────────────────
  // Award XP, roll level, and recompute the consecutive-day streak. Best-effort.
  await awardCompletionRewards(supabase, user.id);

  revalidatePath("/today");
  revalidatePath("/progress");
  return { ok: true, data: { sessionLogId: sessionLogId! } };
}

// ── deleteSession (gap 14) ────────────────────────────────────────────────────
export async function deleteSession(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // block_completions + feed_posts (ref_id) cascade / are independent; delete
  // the log itself. RLS scopes this to the owner; the extra eq is belt-and-braces.
  const { error } = await supabase
    .from("session_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // Keep gamification honest after a removal.
  await awardCompletionRewards(supabase, user.id);

  revalidatePath("/today");
  revalidatePath("/progress");
  return { ok: true };
}

// ── uncompleteSession (gap 14) ────────────────────────────────────────────────
export async function uncompleteSession(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("session_logs")
    .update({ completed: false, completed_at: null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  await awardCompletionRewards(supabase, user.id);

  revalidatePath("/today");
  revalidatePath("/progress");
  return { ok: true };
}

// ── updateSession (gap 14) ────────────────────────────────────────────────────
export async function updateSession(
  id: string,
  patch: { rpe?: number | null; notes?: string | null; durationMin?: number | null },
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};
  if (patch.rpe !== undefined) fields.rpe = patch.rpe;
  if (patch.notes !== undefined) fields.notes = patch.notes;
  if (patch.durationMin !== undefined) fields.duration_min = patch.durationMin;
  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase
    .from("session_logs")
    .update(fields)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/today");
  revalidatePath("/progress");
  return { ok: true };
}

// ── toggleBlock ────────────────────────────────────────────────────────────
export async function toggleBlock(id: string, done: boolean): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("block_completions").update({ done }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/today");
  return { ok: true };
}

// ── Gamification + scheduler helpers ─────────────────────────────────────────

/**
 * Recompute XP / level / streak from the user's completed sessions and persist
 * to profiles. Idempotent w.r.t. a given completed-session set:
 *   • xp     = 50 * (number of completed sessions)
 *   • level  = highest L such that cumulative threshold (sum of k*250, k<L) is met
 *   • streak = consecutive distinct completed days ending today (or yesterday)
 * Derived recomputation (vs. blind increment) keeps numbers correct across
 * delete / uncomplete and avoids drift. Failures are swallowed — gamification is
 * a side effect of completion, never a reason to fail it.
 */
async function awardCompletionRewards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  try {
    const { data: completed } = await supabase
      .from("session_logs")
      .select("date")
      .eq("user_id", userId)
      .eq("completed", true)
      .order("date", { ascending: false });

    const rows = (completed ?? []) as Array<{ date: string }>;
    const xp = rows.length * 50;

    // Level rolls when xp >= level*250 (cumulative): L1 needs 250 to reach L2,
    // L2 needs another 500, etc. Loop to absorb multiple level-ups at once.
    let level = 1;
    let remaining = xp;
    while (remaining >= level * 250) {
      remaining -= level * 250;
      level += 1;
    }

    const streak = consecutiveDayStreak(rows.map((r) => r.date));

    await supabase
      .from("profiles")
      .update({ xp, level, streak_count: streak })
      .eq("id", userId);
  } catch {
    // best-effort: never block the primary mutation
  }
}

/**
 * Count consecutive distinct days (ending today, or yesterday if today has no
 * completion yet) present in `dates` (ISO YYYY-MM-DD). Tolerant of duplicates
 * and unordered input.
 */
function consecutiveDayStreak(dates: string[]): number {
  const set = new Set(dates);
  if (set.size === 0) return 0;

  // Anchor on today if trained today, else yesterday — so an unfinished today
  // doesn't zero out an otherwise-live streak.
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!set.has(toISODate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(toISODate(cursor))) return 0;
  }

  let streak = 0;
  while (set.has(toISODate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Advance the user's active program enrollment cursor to the day ordered
 * immediately after `completedDayId` (within the same program), ordered by
 * (phase, week, day, order). Leaves the cursor unchanged if there is no active
 * enrollment, the completed day isn't in the enrolled program, or there is no
 * later day. Best-effort.
 */
async function advanceEnrollment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  completedDayId: string,
): Promise<void> {
  try {
    const { data: enrollment } = await supabase
      .from("program_enrollments")
      .select("id, program_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const enr = enrollment as { id: string; program_id: string } | null;
    if (!enr) return;

    // Pull the program's days in schedule order; find the completed day's index
    // and the next one. Programs are small (weeks × days), so this is cheap and
    // avoids fragile cross-column "greater-than" filtering.
    const { data: days } = await supabase
      .from("program_days")
      .select("id, phase, week, day, order")
      .eq("program_id", enr.program_id)
      .order("phase", { ascending: true })
      .order("week", { ascending: true })
      .order("day", { ascending: true })
      .order("order", { ascending: true });

    const ordered = (days ?? []) as Array<{ id: string }>;
    const idx = ordered.findIndex((d) => d.id === completedDayId);
    if (idx === -1 || idx + 1 >= ordered.length) return; // not in program, or last day

    const nextDayId = ordered[idx + 1].id;
    await supabase
      .from("program_enrollments")
      .update({ current_day_id: nextDayId })
      .eq("id", enr.id)
      .eq("user_id", userId);
  } catch {
    // best-effort: never block the primary mutation
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CREW LIFECYCLE (gaps 13,18,19,20,24,28,37,38)
// ════════════════════════════════════════════════════════════════════════════

// ── createCrew ────────────────────────────────────────────────────────────────
export interface CreateCrewInput {
  name: string;
  weeklyGoal?: number;
}

export async function createCrew(
  input: CreateCrewInput,
): Promise<ActionResult<{ crewId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Crew name is required" };

  // 1. Create the crew (invite_code defaults in the DB).
  const crewInsert: Record<string, unknown> = { name, created_by: user.id };
  if (input.weeklyGoal != null) crewInsert.weekly_goal = Math.max(1, Math.round(input.weeklyGoal));

  const { data: crew, error: crewErr } = await supabase
    .from("crews")
    .insert(crewInsert)
    .select("id")
    .single();
  if (crewErr || !crew) return { ok: false, error: crewErr?.message ?? "Could not create crew" };
  const crewId = crew.id as string;

  // 2. Add the creator as the owner member.
  const { error: memErr } = await supabase
    .from("crew_members")
    .insert({ crew_id: crewId, user_id: user.id, role: "owner" });
  if (memErr) return { ok: false, error: memErr.message };

  // 3. Point the profile at the new crew.
  await supabase.from("profiles").update({ active_crew_id: crewId }).eq("id", user.id);

  revalidatePath("/crew");
  revalidatePath("/today");
  return { ok: true, data: { crewId } };
}

// ── joinCrew ──────────────────────────────────────────────────────────────────
export async function joinCrew(code: string): Promise<ActionResult<{ crewId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const trimmed = code?.trim();
  if (!trimmed) return { ok: false, error: "Invite code is required" };

  // SECURITY DEFINER fn resolves the hidden crew + inserts membership, returns id.
  const { data, error } = await supabase.rpc("join_crew_by_code", { code: trimmed });
  if (error) return { ok: false, error: error.message };
  const crewId = (data as string | null) ?? null;
  if (!crewId) return { ok: false, error: "No crew found for that code" };

  await supabase.from("profiles").update({ active_crew_id: crewId }).eq("id", user.id);

  revalidatePath("/crew");
  revalidatePath("/today");
  return { ok: true, data: { crewId } };
}

// ── leaveCrew ─────────────────────────────────────────────────────────────────
export async function leaveCrew(crewId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // If the caller is the creator AND the last member, delete the whole crew
  // (cascades members/feed). Otherwise just drop their own membership.
  const { data: crew } = await supabase
    .from("crews")
    .select("created_by")
    .eq("id", crewId)
    .maybeSingle();
  const isCreator = (crew as { created_by: string } | null)?.created_by === user.id;

  if (isCreator) {
    const { count } = await supabase
      .from("crew_members")
      .select("user_id", { count: "exact", head: true })
      .eq("crew_id", crewId);
    if ((count ?? 0) <= 1) {
      const { error } = await supabase.from("crews").delete().eq("id", crewId);
      if (error) return { ok: false, error: error.message };
      await clearActiveCrewIfMatches(supabase, user.id, crewId);
      revalidatePath("/crew");
      revalidatePath("/today");
      return { ok: true };
    }
  }

  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("crew_id", crewId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  await clearActiveCrewIfMatches(supabase, user.id, crewId);

  revalidatePath("/crew");
  revalidatePath("/today");
  return { ok: true };
}

/** If the user's active crew is the one they just left/deleted, repoint it to
 *  another remaining membership (or null). Keeps Today/Crew from dangling. */
async function clearActiveCrewIfMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  crewId: string,
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_crew_id")
    .eq("id", userId)
    .maybeSingle();
  if ((profile as { active_crew_id: string | null } | null)?.active_crew_id !== crewId) return;

  const { data: next } = await supabase
    .from("crew_members")
    .select("crew_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextId = (next as { crew_id: string } | null)?.crew_id ?? null;
  await supabase.from("profiles").update({ active_crew_id: nextId }).eq("id", userId);
}

// ── editCrew ──────────────────────────────────────────────────────────────────
export async function editCrew(
  crewId: string,
  patch: { name?: string; weeklyGoal?: number },
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: "Crew name is required" };
    fields.name = name;
  }
  if (patch.weeklyGoal !== undefined) fields.weekly_goal = Math.max(1, Math.round(patch.weeklyGoal));
  if (Object.keys(fields).length === 0) return { ok: true };

  // RLS (crews_update) restricts this to created_by = auth.uid().
  const { error } = await supabase.from("crews").update(fields).eq("id", crewId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crew");
  revalidatePath("/today");
  return { ok: true };
}

// ── removeMember (owner-only) ─────────────────────────────────────────────────
export async function removeMember(crewId: string, userId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // crew_members_owner_delete RLS allows the crew creator to delete members.
  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("crew_id", crewId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  // Repoint the removed user's active crew away from this one if needed.
  await clearActiveCrewIfMatches(supabase, userId, crewId);

  revalidatePath("/crew");
  return { ok: true };
}

// ── setActiveCrew ─────────────────────────────────────────────────────────────
export async function setActiveCrew(crewId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({ active_crew_id: crewId })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crew");
  revalidatePath("/today");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// FEED + REACTIONS + NUDGES
// ════════════════════════════════════════════════════════════════════════════

// ── react ──────────────────────────────────────────────────────────────────
/** Toggle a reaction emoji on a feed post (add if missing, remove if present). */
export async function react(
  postId: string,
  emoji: string,
): Promise<ActionResult<{ active: boolean }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: existing } = await supabase
    .from("reactions")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .eq("emoji", emoji);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/crew");
    return { ok: true, data: { active: false } };
  }

  const { error } = await supabase
    .from("reactions")
    .insert({ post_id: postId, user_id: user.id, emoji });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crew");
  return { ok: true, data: { active: true } };
}

// ── postNote (gap 25) ─────────────────────────────────────────────────────────
export async function postNote(crewId: string, body: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const text = body?.trim();
  if (!text) return { ok: false, error: "Say something first" };
  if (!crewId) return { ok: false, error: "No crew selected" };

  const { error } = await supabase.from("feed_posts").insert({
    user_id: user.id,
    crew_id: crewId,
    kind: "note",
    body: text,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crew");
  return { ok: true };
}

// ── nudge ──────────────────────────────────────────────────────────────────
export async function nudge(toUser: string, crewId?: string | null): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("nudges").insert({
    from_user: user.id,
    to_user: toUser,
    crew_id: crewId ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crew");
  return { ok: true };
}

// ── markNudgesSeen (gaps 22,40) ───────────────────────────────────────────────
export async function markNudgesSeen(): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("nudges")
    .update({ seen: true })
    .eq("to_user", user.id)
    .eq("seen", false);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/today");
  revalidatePath("/crew");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// PRs (gap 12)
// ════════════════════════════════════════════════════════════════════════════

export interface LogPRInput {
  label: string;
  value: number;
  unit?: string | null;
  achievedOn?: string;
}

export async function logPR(input: LogPRInput): Promise<ActionResult<{ prId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const label = input.label?.trim();
  if (!label) return { ok: false, error: "PR label is required" };
  if (input.value == null || Number.isNaN(input.value)) {
    return { ok: false, error: "PR value is required" };
  }

  const { data: pr, error } = await supabase
    .from("prs")
    .insert({
      user_id: user.id,
      label,
      value: input.value,
      unit: input.unit ?? null,
      achieved_on: input.achievedOn ?? todayISO(),
    })
    .select("id")
    .single();
  if (error || !pr) return { ok: false, error: error?.message ?? "Could not save PR" };
  const prId = pr.id as string;

  // Mirror completeSession's feed insert: announce the PR to the active crew.
  const crewId = await resolveActiveCrewId(supabase, user.id);
  if (crewId) {
    await supabase.from("feed_posts").insert({
      user_id: user.id,
      crew_id: crewId,
      kind: "pr",
      ref_id: prId,
      body: label,
    });
    revalidatePath("/crew");
  }

  revalidatePath("/progress");
  return { ok: true, data: { prId } };
}

export interface UpdatePRInput {
  label?: string;
  value?: number;
  unit?: string | null;
  achievedOn?: string;
}

export async function updatePR(id: string, patch: UpdatePRInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) return { ok: false, error: "PR label is required" };
    fields.label = label;
  }
  if (patch.value !== undefined) {
    if (Number.isNaN(patch.value)) return { ok: false, error: "PR value is invalid" };
    fields.value = patch.value;
  }
  if (patch.unit !== undefined) fields.unit = patch.unit;
  if (patch.achievedOn !== undefined) fields.achieved_on = patch.achievedOn;
  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase
    .from("prs")
    .update(fields)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/progress");
  revalidatePath("/crew");
  return { ok: true };
}

export async function deletePR(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("prs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/progress");
  revalidatePath("/crew");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// BODY & FUEL
// ════════════════════════════════════════════════════════════════════════════

// ── logBody ────────────────────────────────────────────────────────────────
export interface LogBodyInput {
  date?: string;
  weight?: number | null;
  bodyFat?: number | null;
  waist?: number | null;
  extra?: unknown;
}

export async function logBody(input: LogBodyInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("body_metrics").upsert(
    {
      user_id: user.id,
      date: input.date ?? todayISO(),
      weight: input.weight ?? null,
      body_fat: input.bodyFat ?? null,
      waist: input.waist ?? null,
      extra: input.extra ?? null,
    },
    { onConflict: "user_id,date" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true };
}

// ── logMeal ────────────────────────────────────────────────────────────────
export interface LogMealInput {
  date?: string;
  meal?: string | null;
  kcal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}

export async function logMeal(input: LogMealInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("nutrition_logs").insert({
    user_id: user.id,
    date: input.date ?? todayISO(),
    meal: input.meal ?? null,
    kcal: input.kcal ?? null,
    protein: input.protein ?? null,
    carbs: input.carbs ?? null,
    fat: input.fat ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true };
}

// ── updateMeal (gaps 15,16) ───────────────────────────────────────────────────
export interface UpdateMealInput {
  meal?: string | null;
  kcal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}

export async function updateMeal(id: string, patch: UpdateMealInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};
  if (patch.meal !== undefined) fields.meal = patch.meal;
  if (patch.kcal !== undefined) fields.kcal = patch.kcal;
  if (patch.protein !== undefined) fields.protein = patch.protein;
  if (patch.carbs !== undefined) fields.carbs = patch.carbs;
  if (patch.fat !== undefined) fields.fat = patch.fat;
  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase
    .from("nutrition_logs")
    .update(fields)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true };
}

// ── deleteMeal (gaps 15,16) ───────────────────────────────────────────────────
export async function deleteMeal(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("nutrition_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true };
}

// ── logWater ───────────────────────────────────────────────────────────────
/** Add `ml` to today's water total (creates the row if absent). */
export async function logWater(ml: number, date?: string): Promise<ActionResult<{ ml: number }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const day = date ?? todayISO();
  const { data: existing } = await supabase
    .from("water_logs")
    .select("ml")
    .eq("user_id", user.id)
    .eq("date", day)
    .maybeSingle();

  const total = Math.max(0, (existing?.ml ?? 0) + ml);
  const { error } = await supabase
    .from("water_logs")
    .upsert({ user_id: user.id, date: day, ml: total }, { onConflict: "user_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true, data: { ml: total } };
}

// ── setWater (gaps 15,16) ─────────────────────────────────────────────────────
/** Set the day's water total to an exact ml value (clamped >= 0). */
export async function setWater(ml: number, date?: string): Promise<ActionResult<{ ml: number }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const day = date ?? todayISO();
  const total = Math.max(0, Math.round(ml));
  const { error } = await supabase
    .from("water_logs")
    .upsert({ user_id: user.id, date: day, ml: total }, { onConflict: "user_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true, data: { ml: total } };
}

// ── clearWater (gaps 15,16) ───────────────────────────────────────────────────
/** Reset the day's water total to 0. */
export async function clearWater(date?: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const day = date ?? todayISO();
  const { error } = await supabase
    .from("water_logs")
    .upsert({ user_id: user.id, date: day, ml: 0 }, { onConflict: "user_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/body");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// PROFILE & APPEARANCE
// ════════════════════════════════════════════════════════════════════════════

// ── updateProfile (gaps 26,27) ────────────────────────────────────────────────
export interface UpdateProfileInput {
  display_name?: string;
  avatar_url?: string | null;
}

export async function updateProfile(input: UpdateProfileInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};
  if (input.display_name !== undefined) {
    const name = input.display_name.trim();
    if (!name) return { ok: false, error: "Display name is required" };
    fields.display_name = name;
  }
  if (input.avatar_url !== undefined) fields.avatar_url = input.avatar_url;
  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase.from("profiles").update(fields).eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

// ── saveAppearance ─────────────────────────────────────────────────────────
export async function saveAppearance(appearance: Appearance): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({ appearance, units: appearance.units })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
