"use server";

/**
 * Path Warden — server actions (mutations). Each uses the server Supabase client
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
import type {
  BlockType,
  CadenceType,
  Json,
  TrackerPeriod,
  TrackerType,
} from "@/lib/types";
// Appearance's typed/normalized shape is owned by ThemeProvider (gap 42); the
// `import type` is erased at compile time, so importing it into this server
// module does not cross the client/server boundary.
import type { Appearance } from "@/components/ThemeProvider";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ── Free-text length bounds (gap: server-side input caps) ───────────────────
// Server actions previously validated non-empty but never capped length, so a
// caller hitting the action (or the table directly via the publishable key)
// could persist arbitrarily large strings — UI flooding / storage abuse,
// especially for the shared crew feed. These caps are enforced here AND mirror
// CHECK constraints in supabase/migrations/0005_security.sql so the direct-table
// path is bounded too. Limits are >= the client `maxLength` so valid input is
// never rejected; the note cap matches the feed textarea's maxLength (280).
const LIMITS = {
  noteBody: 280, // crew feed note (mirrors textarea maxLength)
  displayName: 80,
  crewName: 80,
  sessionTitle: 200,
  prLabel: 120,
  unit: 24,
  mealName: 120,
  blockLabel: 200,
  notes: 4000, // session notes (a few KB)
  avatarUrl: 2048, // URL — generous but bounded
  trackerTitle: 120, // goal/tracker title
  trackerUnit: 24, // amount_per_week unit label (min/pages/…)
  trackerNote: 280, // per-day log note (mirrors the feed note cap)
} as const;

/**
 * Validate that a (already-trimmed) string is within `max` characters,
 * returning an error result when it overflows (else null). Length is measured by
 * Unicode code units (String.length), matching the textarea `maxLength` the
 * client enforces; the DB CHECKs use char_length, which is >= this for the
 * BMP-dominant content here, so a server-accepted value never trips a CHECK.
 *
 * Typed as ActionResult<never> so the error return is assignable to any
 * ActionResult<T> caller (the data-bearing actions like completeSession /
 * createCrew / logPR), since it never carries a `data` payload.
 */
function tooLong(value: string, max: number, label: string): ActionResult<never> | null {
  if (value.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or fewer` };
  }
  return null;
}

/**
 * Canonicalize a user-supplied avatar URL, enforcing an https-only scheme.
 *
 * avatar_url is persisted to profiles and (today) rendered as `<img src>` in
 * the owner's own account preview. Without this check a caller can store a
 * javascript:/data:/blob: or arbitrary external URL; in an <img src> that is a
 * tracking/beacon vector rather than script execution, but it is still
 * unwanted, and if avatars ever become visible to crew-mates an unvalidated
 * value becomes a cross-user beacon. We require an absolute https: URL so the
 * stored value is always a safe, network-only image reference. This is the
 * server-side trust boundary (the publishable key reaches this action via the
 * client); a matching CHECK in supabase/migrations/0005_security_avatar_url.sql
 * bounds the direct-to-PostgREST path, and safeAvatarUrl() in
 * account/_components.tsx is the client mirror.
 *
 * Returns { value } with the canonical https URL (or null when the input is
 * blank/null → clears the avatar), or { error } when a non-blank value is not
 * a valid https URL.
 */
function normalizeAvatarUrl(
  raw: string | null | undefined,
): { value: string | null } | { error: string } {
  if (raw == null) return { value: null };
  const v = raw.trim();
  if (!v) return { value: null };
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return { error: "Avatar URL must be a full https:// link" };
  }
  if (parsed.protocol !== "https:") {
    return { error: "Avatar URL must be a full https:// link" };
  }
  return { value: parsed.toString() };
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

  // Bound free-text before persisting (the row is also reachable directly via
  // the publishable key — caps are mirrored as DB CHECKs in 0005_security.sql).
  const titleErr = tooLong(input.title ?? "", LIMITS.sessionTitle, "Title");
  if (titleErr) return titleErr;
  if (input.notes != null) {
    const notesErr = tooLong(input.notes, LIMITS.notes, "Notes");
    if (notesErr) return notesErr;
  }
  for (const b of input.blocks ?? []) {
    const labelErr = tooLong(b.label ?? "", LIMITS.blockLabel, "Block label");
    if (labelErr) return labelErr;
  }

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
  } else if (sessionLogId) {
    // Re-completing a session can flip shared true → false (or drop the crew).
    // feed_posts has no FK to session_logs, so an earlier post would otherwise
    // linger in the feed — remove it. Idempotent: a no-op when none exists.
    // feed_delete RLS scopes this to the author.
    await supabase
      .from("feed_posts")
      .delete()
      .eq("user_id", user.id)
      .eq("kind", "session")
      .eq("ref_id", sessionLogId);
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

  // block_completions cascade via FK; delete the log itself. RLS scopes this to
  // the owner; the extra eq is belt-and-braces.
  const { error } = await supabase
    .from("session_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // feed_posts has no FK to session_logs (ref_id is a bare uuid), so the crew
  // post does not cascade. Remove the matching post so a deleted session stops
  // showing in the feed. feed_delete RLS scopes this to the author.
  await supabase
    .from("feed_posts")
    .delete()
    .eq("user_id", user.id)
    .eq("kind", "session")
    .eq("ref_id", id);

  // Keep gamification honest after a removal.
  await awardCompletionRewards(supabase, user.id);

  revalidatePath("/today");
  revalidatePath("/progress");
  revalidatePath("/crew");
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
  if (patch.notes !== undefined) {
    if (patch.notes != null) {
      const notesErr = tooLong(patch.notes, LIMITS.notes, "Notes");
      if (notesErr) return notesErr;
    }
    fields.notes = patch.notes;
  }
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
  // Retained for call-site compatibility; the definer fn derives the user from
  // auth.uid() and only ever writes that row.
  _userId: string,
): Promise<void> {
  try {
    // xp/level/streak_count are no longer client-updatable (column UPDATE
    // revoked from anon/authenticated in migration 0003, so a direct REST PATCH
    // cannot fabricate leaderboard stats). recompute_my_stats() is a SECURITY
    // DEFINER fn that recomputes from the caller's own completed sessions using
    // the identical xp = 50*n / level-roll / consecutive-day-streak formula and
    // writes only the caller's row — same logic, on the trusted side.
    await supabase.rpc("recompute_my_stats");
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
  const nameErr = tooLong(name, LIMITS.crewName, "Crew name");
  if (nameErr) return nameErr;

  // Crew + owner membership + active-crew pointer are created atomically inside
  // a SECURITY DEFINER fn (create_crew). Direct client INSERTs into crew_members
  // are no longer permitted — default-deny, see migration 0003 — so the owner
  // row MUST be created server-side; the fn also forces role='owner' so it can
  // never be client-selected. The DB still defaults invite_code/weekly_goal.
  const weeklyGoal =
    input.weeklyGoal != null ? Math.max(1, Math.round(input.weeklyGoal)) : null;

  const { data, error } = await supabase.rpc("create_crew", {
    p_name: name,
    p_weekly_goal: weeklyGoal,
  });
  if (error) return { ok: false, error: error.message };
  const crewId = (data as string | null) ?? null;
  if (!crewId) return { ok: false, error: "Could not create crew" };

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
    const nameErr = tooLong(name, LIMITS.crewName, "Crew name");
    if (nameErr) return nameErr;
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

  // We intentionally do NOT touch the removed member's profiles.active_crew_id
  // here. Under RLS a user's active_crew_id can only be mutated by that user
  // (profiles_update: id = auth.uid()), and once removed the owner no longer
  // shares the crew, so profiles_select hides the row too — any attempt would
  // be a silent cross-user no-op. The dangling pointer is harmless: the read
  // side (resolveActiveCrewId in both queries.ts and this file) re-validates
  // membership and falls back to the earliest remaining crew (or null).
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
  // Cap note length server-side: the 280-char limit was only the textarea's
  // client maxLength, bypassable by calling this action (or the feed_posts
  // table) directly — without this a crew-mate could flood the shared feed.
  const bodyErr = tooLong(text, LIMITS.noteBody, "Note");
  if (bodyErr) return bodyErr;

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

  // crew_id is client-supplied. Don't persist a crew the sender isn't in:
  // validate sender membership here (clean error). The DB backstop in
  // 0003_security.sql is the nudges_insert WITH CHECK, which is stricter still —
  // it requires crew_id to be null OR a crew BOTH sender and recipient belong to
  // — so the direct-to-PostgREST path is constrained even without this. The
  // membership read is RLS-scoped (crew_members_select): a visible row == member.
  const crew = crewId ?? null;
  if (crew) {
    const { data: membership } = await supabase
      .from("crew_members")
      .select("crew_id")
      .eq("crew_id", crew)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return { ok: false, error: "Not a member of that crew" };
  }

  // Don't nudge yourself.
  if (toUser === user.id) return { ok: false, error: "You can't nudge yourself" };

  // Server-side abuse throttle (defense-in-depth alongside the RLS WITH CHECK +
  // partial-unique index added in 0006_rate_limit.sql). Without this, a malicious
  // crew-mate could spam a target with thousands of nudges (notification
  // harassment / DB bloat). Two layers, both also enforced at the table:
  //   • one outstanding UNSEEN nudge per (sender → target) — collapse dupes
  //   • at most NUDGE_RATE_MAX nudges to one target per NUDGE_RATE_WINDOW
  // We check here too so abusers get a clean message instead of a raw DB error,
  // and so the throttle holds even if the policy is ever relaxed.
  const NUDGE_RATE_MAX = 5;
  const NUDGE_RATE_WINDOW_MS = 10 * 60 * 1000; // keep in sync with 0006
  const windowStart = new Date(Date.now() - NUDGE_RATE_WINDOW_MS).toISOString();

  // Already an unseen nudge waiting? Treat as a no-op success — the target is
  // already poked, and the unique index would otherwise reject a duplicate.
  const { data: pending } = await supabase
    .from("nudges")
    .select("id")
    .eq("from_user", user.id)
    .eq("to_user", toUser)
    .eq("seen", false)
    .maybeSingle();
  if (pending) return { ok: true };

  const { count: recentCount } = await supabase
    .from("nudges")
    .select("id", { count: "exact", head: true })
    .eq("from_user", user.id)
    .eq("to_user", toUser)
    .gte("created_at", windowStart);
  if ((recentCount ?? 0) >= NUDGE_RATE_MAX) {
    return { ok: false, error: "You've nudged them plenty for now — give it a bit." };
  }

  const { error } = await supabase.from("nudges").insert({
    from_user: user.id,
    to_user: toUser,
    crew_id: crew,
  });
  if (error) {
    // 23505 = duplicate unseen nudge raced past the pre-check (collapse it);
    // 42501 = RLS WITH CHECK rejected it (rate cap reached under the DB clock).
    if (error.code === "23505") return { ok: true };
    if (error.code === "42501") {
      return { ok: false, error: "You've nudged them plenty for now — give it a bit." };
    }
    return { ok: false, error: error.message };
  }

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
  const labelErr = tooLong(label, LIMITS.prLabel, "PR label");
  if (labelErr) return labelErr;
  if (input.unit != null) {
    const unitErr = tooLong(input.unit, LIMITS.unit, "Unit");
    if (unitErr) return unitErr;
  }
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
    const labelErr = tooLong(label, LIMITS.prLabel, "PR label");
    if (labelErr) return labelErr;
    fields.label = label;
  }
  if (patch.value !== undefined) {
    if (Number.isNaN(patch.value)) return { ok: false, error: "PR value is invalid" };
    fields.value = patch.value;
  }
  if (patch.unit !== undefined) {
    if (patch.unit != null) {
      const unitErr = tooLong(patch.unit, LIMITS.unit, "Unit");
      if (unitErr) return unitErr;
    }
    fields.unit = patch.unit;
  }
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

  if (input.meal != null) {
    const mealErr = tooLong(input.meal, LIMITS.mealName, "Meal");
    if (mealErr) return mealErr;
  }

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
  if (patch.meal !== undefined) {
    if (patch.meal != null) {
      const mealErr = tooLong(patch.meal, LIMITS.mealName, "Meal");
      if (mealErr) return mealErr;
    }
    fields.meal = patch.meal;
  }
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
    const nameErr = tooLong(name, LIMITS.displayName, "Display name");
    if (nameErr) return nameErr;
    fields.display_name = name;
  }
  if (input.avatar_url !== undefined) {
    if (input.avatar_url != null) {
      const urlErr = tooLong(input.avatar_url, LIMITS.avatarUrl, "Avatar URL");
      if (urlErr) return urlErr;
    }
    // Enforce an https-only scheme (rejects javascript:/data:/blob:/non-http
    // and malformed URLs). Blank/null clears the avatar. The canonicalized
    // value is what we persist.
    const avatar = normalizeAvatarUrl(input.avatar_url);
    if ("error" in avatar) return { ok: false, error: avatar.error };
    fields.avatar_url = avatar.value;
  }
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

// ── saveTrainingGoal ───────────────────────────────────────────────────────
/**
 * Persist the user's training goal (0009) and re-derive the streak. The streak
 * rule lives server-side in set_my_training_goal() (SECURITY DEFINER), which
 * validates input, writes only the caller's row, and calls recompute_my_stats().
 *   • type "days"  → `days` = scheduled weekdays (0=Sun..6=Sat); rest days never
 *                    break the streak.
 *   • type "count" → `target` = sessions/week; streak counts consecutive weeks.
 */
export async function saveTrainingGoal(input: {
  type: "days" | "count";
  days: number[];
  target: number;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  if (input.type === "days" && input.days.length === 0) {
    return { ok: false, error: "Pick at least one training day." };
  }

  const { error } = await supabase.rpc("set_my_training_goal", {
    p_type: input.type,
    p_days: input.days,
    p_target: input.target,
  });
  if (error) return { ok: false, error: error.message };

  // Streak (in the header), Today, and Progress all read the recomputed stats.
  revalidatePath("/", "layout");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════
// TRACKERS / GOALS (0010)
// All RLS-safe: every write is scoped to user_id = auth.uid() and the
// trackers/tracker_logs policies (0010) enforce ownership at the DB too.
// ════════════════════════════════════════════════════════════════════════

const TRACKER_TYPES: readonly TrackerType[] = ["exercise", "diet", "bible", "custom"];
const CADENCE_TYPES: readonly CadenceType[] = [
  "times_per_week",
  "amount_per_week",
  "specific_weekdays",
  "daily_binary",
];
const TRACKER_PERIODS: readonly TrackerPeriod[] = ["weekly", "monthly"];

/** Sanitize a weekday array to distinct, sorted Postgres dow values (0..6). */
function cleanWeekdays(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

// ── createTracker ────────────────────────────────────────────────────────
export interface CreateTrackerInput {
  type: TrackerType;
  title: string;
  cadenceType: CadenceType;
  icon?: string | null;
  accent?: string | null;
  period?: TrackerPeriod;
  weeklyTargetCount?: number | null;
  weeklyTargetAmount?: number | null;
  unit?: string | null;
  scheduledWeekdays?: number[] | null;
  config?: Json;
  shared?: boolean;
  sortOrder?: number;
}

export async function createTracker(
  input: CreateTrackerInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  if (!TRACKER_TYPES.includes(input.type)) return { ok: false, error: "Invalid tracker type" };
  if (!CADENCE_TYPES.includes(input.cadenceType))
    return { ok: false, error: "Invalid cadence type" };

  const title = input.title?.trim() ?? "";
  if (!title) return { ok: false, error: "Title is required" };
  const titleErr = tooLong(title, LIMITS.trackerTitle, "Title");
  if (titleErr) return titleErr;

  const unit = input.unit?.trim() || null;
  if (unit) {
    const unitErr = tooLong(unit, LIMITS.trackerUnit, "Unit");
    if (unitErr) return unitErr;
  }

  const period = input.period && TRACKER_PERIODS.includes(input.period) ? input.period : "weekly";
  const weekdays =
    input.cadenceType === "specific_weekdays" ? cleanWeekdays(input.scheduledWeekdays) : null;
  if (input.cadenceType === "specific_weekdays" && (weekdays?.length ?? 0) === 0) {
    return { ok: false, error: "Pick at least one weekday" };
  }

  const { data, error } = await supabase
    .from("trackers")
    .insert({
      user_id: user.id,
      type: input.type,
      title,
      icon: input.icon?.trim() || null,
      accent: input.accent?.trim() || null,
      cadence_type: input.cadenceType,
      period,
      weekly_target_count:
        input.cadenceType === "times_per_week"
          ? Math.max(1, Math.trunc(input.weeklyTargetCount ?? 1))
          : (input.weeklyTargetCount ?? null),
      weekly_target_amount:
        input.cadenceType === "amount_per_week"
          ? Math.max(0, input.weeklyTargetAmount ?? 0)
          : (input.weeklyTargetAmount ?? null),
      unit,
      scheduled_weekdays: weekdays,
      config: input.config ?? {},
      shared: input.shared ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .select("id")
    .single();

  if (error) {
    // The partial unique index (user_id, type) where type <> 'custom' surfaces
    // as a 23505; translate it into a friendly singleton message.
    if (error.code === "23505") {
      return { ok: false, error: `You already have a ${input.type} tracker` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/goals");
  return { ok: true, data: { id: data.id as string } };
}

// ── updateTracker ──────────────────────────────────────────────────────────
export interface UpdateTrackerInput {
  title?: string;
  icon?: string | null;
  accent?: string | null;
  cadenceType?: CadenceType;
  period?: TrackerPeriod;
  weeklyTargetCount?: number | null;
  weeklyTargetAmount?: number | null;
  unit?: string | null;
  scheduledWeekdays?: number[] | null;
  config?: Json;
  shared?: boolean;
  sortOrder?: number;
}

export async function updateTracker(
  id: string,
  patch: UpdateTrackerInput,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const fields: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { ok: false, error: "Title is required" };
    const titleErr = tooLong(title, LIMITS.trackerTitle, "Title");
    if (titleErr) return titleErr;
    fields.title = title;
  }
  if (patch.icon !== undefined) fields.icon = patch.icon?.trim() || null;
  if (patch.accent !== undefined) fields.accent = patch.accent?.trim() || null;
  if (patch.cadenceType !== undefined) {
    if (!CADENCE_TYPES.includes(patch.cadenceType))
      return { ok: false, error: "Invalid cadence type" };
    fields.cadence_type = patch.cadenceType;
  }
  if (patch.period !== undefined) {
    if (!TRACKER_PERIODS.includes(patch.period))
      return { ok: false, error: "Invalid period" };
    fields.period = patch.period;
  }
  if (patch.weeklyTargetCount !== undefined) fields.weekly_target_count = patch.weeklyTargetCount;
  if (patch.weeklyTargetAmount !== undefined)
    fields.weekly_target_amount = patch.weeklyTargetAmount;
  if (patch.unit !== undefined) {
    const unit = patch.unit?.trim() || null;
    if (unit) {
      const unitErr = tooLong(unit, LIMITS.trackerUnit, "Unit");
      if (unitErr) return unitErr;
    }
    fields.unit = unit;
  }
  if (patch.scheduledWeekdays !== undefined) {
    const days = cleanWeekdays(patch.scheduledWeekdays);
    fields.scheduled_weekdays = days.length ? days : null;
  }
  if (patch.config !== undefined) fields.config = patch.config;
  if (patch.shared !== undefined) fields.shared = patch.shared;
  if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;

  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase
    .from("trackers")
    .update(fields)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/goals");
  return { ok: true };
}

// ── archiveTracker ─────────────────────────────────────────────────────────
/** Soft-delete: archive (or restore) a tracker so it leaves the active list. */
export async function archiveTracker(
  id: string,
  archived = true,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("trackers")
    .update({ archived })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/goals");
  return { ok: true };
}

// ── logTracker ─────────────────────────────────────────────────────────────
export interface LogTrackerInput {
  trackerId: string;
  /** Defaults to today. */
  date?: string;
  /** 1 for binary / a session; the amount for amount_per_week. Defaults to 1. */
  value?: number;
  note?: string | null;
}

/**
 * Upsert today's (or a given day's) log for a tracker — one row per
 * (tracker, date). RLS-safe: the tracker_logs WITH CHECK requires the tracker
 * be owned by auth.uid(), and a DB trigger forces tracker_logs.user_id to the
 * tracker's owner regardless of what is sent.
 */
export async function logTracker(input: LogTrackerInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  if (!input.trackerId) return { ok: false, error: "Missing tracker" };
  const note = input.note?.trim() || null;
  if (note) {
    const noteErr = tooLong(note, LIMITS.trackerNote, "Note");
    if (noteErr) return noteErr;
  }

  const { error } = await supabase.from("tracker_logs").upsert(
    {
      tracker_id: input.trackerId,
      user_id: user.id, // normalized to the tracker owner by the DB trigger
      date: input.date ?? todayISO(),
      value: input.value ?? 1,
      note,
    },
    { onConflict: "tracker_id,date" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/goals");
  return { ok: true };
}

// ── unlogTracker ───────────────────────────────────────────────────────────
/** Remove a day's log for a tracker (e.g. untick a daily_binary day). */
export async function unlogTracker(
  trackerId: string,
  date?: string,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("tracker_logs")
    .delete()
    .eq("tracker_id", trackerId)
    .eq("date", date ?? todayISO())
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/goals");
  return { ok: true };
}
