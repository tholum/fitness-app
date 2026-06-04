"use server";

/**
 * BASECAMP — program authoring & enrollment mutations.
 *
 * Kept separate from actions.ts so the two server-action modules compile and
 * run in parallel. Covers the 0002 features: program/day/block/exercise-row
 * CRUD + reordering, the reusable exercise library, enrollment/scheduler, and
 * JSON import/export round-tripping.
 *
 * All writes go through the server Supabase client (RLS enforces ownership via
 * the owner_id / parent-chain policies in 0002_features.sql) and revalidate the
 * affected routes. References 0002 tables by name:
 *   programs, program_days, program_blocks, program_exercises,
 *   exercises, program_enrollments  (+ rpc clone_program).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import type { BlockType } from "@/lib/types";

/** Mirrors the shape in actions.ts so callers can treat both modules uniformly. */
export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Re-declared locally (the actions.ts copy isn't exported) — same behavior. */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Revalidate every route whose data depends on program/exercise content. */
function revalidateProgramRoutes() {
  revalidatePath("/programs");
  revalidatePath("/exercises");
  revalidatePath("/today");
  revalidatePath("/checkin");
}

/** Strip `undefined` keys so a partial update never overwrites columns with null. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// ════════════════════════════════════════════════════════════════════════════
// PROGRAM CRUD (gaps 1, 11, 29, 34)
// ════════════════════════════════════════════════════════════════════════════

export interface CreateProgramInput {
  name: string;
  source?: string;
}

/** Insert a new owned, private program; returns its id. */
export async function createProgram(
  input: CreateProgramInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("programs")
    .insert({
      owner_id: user.id,
      is_public: false,
      name: input.name,
      source: input.source ?? "custom",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data.id as string } };
}

export interface UpdateProgramInput {
  name?: string;
  source?: string;
}

export async function updateProgram(
  id: string,
  input: UpdateProgramInput,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const patch = defined({ name: input.name, source: input.source });
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("programs")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

export async function deleteProgram(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("programs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/**
 * Deep-copy a public/template program into an owned, editable copy (gap 6).
 * Delegates to the SECURITY DEFINER `clone_program` RPC so the ownerless seeded
 * MTNTOUGH plan (owner_id NULL, otherwise locked) can be forked.
 */
export async function cloneProgram(srcId: string): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("clone_program", { src: srcId });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Clone failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data as string } };
}

// ════════════════════════════════════════════════════════════════════════════
// DAY CRUD / REORDER (gaps 1, 7)
// ════════════════════════════════════════════════════════════════════════════

export interface DayInput {
  title: string;
  phase?: number;
  week?: number;
  day?: number;
  estMinutes?: number | null;
  videoUrl?: string | null;
}

/** Append a day to a program (order = current max + 1). */
export async function createDay(
  programId: string,
  input: DayInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: last } = await supabase
    .from("program_days")
    .select("order")
    .eq("program_id", programId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_days")
    .insert({
      program_id: programId,
      title: input.title,
      phase: input.phase ?? 1,
      week: input.week ?? 1,
      day: input.day ?? 1,
      est_minutes: input.estMinutes ?? null,
      video_url: input.videoUrl ?? null,
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data.id as string } };
}

/** Update a day; `videoUrl` persists program_days.video_url (gap 7). */
export async function updateDay(dayId: string, input: DayInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const patch = defined({
    title: input.title,
    phase: input.phase,
    week: input.week,
    day: input.day,
    est_minutes: input.estMinutes,
    video_url: input.videoUrl,
  });
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("program_days").update(patch).eq("id", dayId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

export async function deleteDay(dayId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_days").delete().eq("id", dayId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/** Persist a new day ordering by writing program_days.order for each id. */
export async function reorderDays(
  programId: string,
  orderedDayIds: string[],
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  for (let i = 0; i < orderedDayIds.length; i++) {
    const { error } = await supabase
      .from("program_days")
      .update({ order: i })
      .eq("id", orderedDayIds[i])
      .eq("program_id", programId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateProgramRoutes();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCK CRUD / REORDER (gap 2)
// ════════════════════════════════════════════════════════════════════════════

export interface BlockInput {
  label: string;
  type?: BlockType;
  detail?: string | null;
}

/** Append a block to a day (order = current max + 1). */
export async function createBlock(
  dayId: string,
  input: BlockInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: last } = await supabase
    .from("program_blocks")
    .select("order")
    .eq("program_day_id", dayId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_blocks")
    .insert({
      program_day_id: dayId,
      label: input.label,
      type: input.type ?? "other",
      detail: input.detail ?? null,
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateBlock(blockId: string, input: BlockInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const patch = defined({ label: input.label, type: input.type, detail: input.detail });
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("program_blocks").update(patch).eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

export async function deleteBlock(blockId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_blocks").delete().eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/** Persist a new block ordering within a day. */
export async function reorderBlocks(
  dayId: string,
  orderedBlockIds: string[],
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  for (let i = 0; i < orderedBlockIds.length; i++) {
    const { error } = await supabase
      .from("program_blocks")
      .update({ order: i })
      .eq("id", orderedBlockIds[i])
      .eq("program_day_id", dayId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateProgramRoutes();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// EXERCISE-ROW CRUD / REORDER (gap 2) — writes program_exercises
// ════════════════════════════════════════════════════════════════════════════

export interface ExerciseRowInput {
  /** Optional link back to the reusable library entry (exercises.id). */
  exerciseId?: string | null;
  name: string;
  sets?: number | null;
  reps?: string | null;
  load?: string | null;
  distance?: string | null;
  time?: string | null;
  rest?: string | null;
  notes?: string | null;
}

/** Append an exercise row to a block (order = current max + 1). */
export async function createExerciseRow(
  blockId: string,
  input: ExerciseRowInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: last } = await supabase
    .from("program_exercises")
    .select("order")
    .eq("program_block_id", blockId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_exercises")
    .insert({
      program_block_id: blockId,
      exercise_id: input.exerciseId ?? null,
      name: input.name,
      sets: input.sets ?? null,
      reps: input.reps ?? null,
      load: input.load ?? null,
      distance: input.distance ?? null,
      time: input.time ?? null,
      rest: input.rest ?? null,
      notes: input.notes ?? null,
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateExerciseRow(
  id: string,
  input: ExerciseRowInput,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const patch = defined({
    exercise_id: input.exerciseId,
    name: input.name,
    sets: input.sets,
    reps: input.reps,
    load: input.load,
    distance: input.distance,
    time: input.time,
    rest: input.rest,
    notes: input.notes,
  });
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("program_exercises").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

export async function deleteExerciseRow(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_exercises").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/** Persist a new exercise-row ordering within a block. */
export async function reorderExerciseRows(
  blockId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("program_exercises")
      .update({ order: i })
      .eq("id", orderedIds[i])
      .eq("program_block_id", blockId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateProgramRoutes();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// EXERCISE LIBRARY CRUD (gap 3) — reusable `exercises`
// ════════════════════════════════════════════════════════════════════════════

export type ExerciseCategory =
  | "warmup"
  | "strength"
  | "conditioning"
  | "mobility"
  | "other";

export interface CreateExerciseInput {
  name: string;
  category?: ExerciseCategory;
  defaultVideoUrl?: string | null;
  cues?: string | null;
}

export async function createExercise(
  input: CreateExerciseInput,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("exercises")
    .insert({
      owner_id: user.id,
      is_public: false,
      name: input.name,
      category: input.category ?? "strength",
      default_video_url: input.defaultVideoUrl ?? null,
      cues: input.cues ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { id: data.id as string } };
}

export interface UpdateExerciseInput {
  name?: string;
  category?: ExerciseCategory;
  defaultVideoUrl?: string | null;
  cues?: string | null;
}

export async function updateExercise(
  id: string,
  input: UpdateExerciseInput,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const patch = defined({
    name: input.name,
    category: input.category,
    default_video_url: input.defaultVideoUrl,
    cues: input.cues,
  });
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("exercises")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

export async function deleteExercise(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("exercises")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// ENROLLMENT / SCHEDULER (gaps 4, 5, 30, 35, 36)
// ════════════════════════════════════════════════════════════════════════════

/** Internal: demote any currently-active enrollment to 'paused' for this user. */
async function pauseActiveEnrollments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uid: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("program_enrollments")
    .update({ status: "paused" })
    .eq("user_id", uid)
    .eq("status", "active");
  return { error: error?.message };
}

/**
 * Enroll the user in a program and make it the active one.
 *
 * Deactivates any other active enrollment first (to respect the one-active
 * partial unique index), then upserts this program's enrollment with status
 * 'active', started_on = today, and current_day_id = the lowest-ordered day.
 */
export async function enrollInProgram(
  programId: string,
): Promise<ActionResult<{ enrollmentId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // Lowest-ordered day becomes the scheduler cursor.
  const { data: firstDay } = await supabase
    .from("program_days")
    .select("id")
    .eq("program_id", programId)
    .order("order", { ascending: true })
    .limit(1)
    .maybeSingle();

  const paused = await pauseActiveEnrollments(supabase, user.id);
  if (paused.error) return { ok: false, error: paused.error };

  const { data, error } = await supabase
    .from("program_enrollments")
    .upsert(
      {
        user_id: user.id,
        program_id: programId,
        status: "active",
        started_on: todayISO(),
        current_day_id: (firstDay?.id as string | undefined) ?? null,
      },
      { onConflict: "user_id,program_id" },
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Enroll failed" };

  revalidateProgramRoutes();
  return { ok: true, data: { enrollmentId: data.id as string } };
}

/**
 * Make an already-enrolled program the active one (flip statuses): pause the
 * current active enrollment, then set the target program's enrollment active.
 */
export async function setActiveProgram(programId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const paused = await pauseActiveEnrollments(supabase, user.id);
  if (paused.error) return { ok: false, error: paused.error };

  const { error } = await supabase
    .from("program_enrollments")
    .update({ status: "active" })
    .eq("user_id", user.id)
    .eq("program_id", programId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/** Remove the user's enrollment in a program entirely. */
export async function unenroll(programId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("program_enrollments")
    .delete()
    .eq("user_id", user.id)
    .eq("program_id", programId);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

/** Day-picker override: point an enrollment's scheduler cursor at a given day. */
export async function setCurrentDay(
  enrollmentId: string,
  dayId: string,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("program_enrollments")
    .update({ current_day_id: dayId })
    .eq("id", enrollmentId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidateProgramRoutes();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT (gap 8) — round-trippable JSON
// ════════════════════════════════════════════════════════════════════════════

/** Per-exercise row in the import/export payload. */
export interface ProgramExportExercise {
  name: string;
  sets?: number | null;
  reps?: string | null;
  load?: string | null;
  distance?: string | null;
  time?: string | null;
  rest?: string | null;
  notes?: string | null;
}

/** A block within a day, carrying its exercise rows. */
export interface ProgramExportBlock {
  label: string;
  type?: BlockType | null;
  detail?: string | null;
  exercises: ProgramExportExercise[];
}

/** A day within the program, carrying its blocks. */
export interface ProgramExportDay {
  phase?: number;
  week?: number;
  day?: number;
  title: string;
  est_minutes?: number | null;
  video_url?: string | null;
  blocks: ProgramExportBlock[];
}

/** The full round-trip JSON shape for a program. */
export interface ProgramExportPayload {
  program: { name: string; source?: string };
  days: ProgramExportDay[];
}

/** Narrowing guard so a parsed-from-JSON payload is validated before insert. */
function validatePayload(payload: unknown): payload is ProgramExportPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  const program = p.program as Record<string, unknown> | undefined;
  if (!program || typeof program.name !== "string") return false;
  if (!Array.isArray(p.days)) return false;
  for (const d of p.days as unknown[]) {
    if (typeof d !== "object" || d === null) return false;
    const day = d as Record<string, unknown>;
    if (typeof day.title !== "string") return false;
    if (!Array.isArray(day.blocks)) return false;
    for (const b of day.blocks as unknown[]) {
      if (typeof b !== "object" || b === null) return false;
      const block = b as Record<string, unknown>;
      if (typeof block.label !== "string") return false;
      if (!Array.isArray(block.exercises)) return false;
      for (const e of block.exercises as unknown[]) {
        if (typeof e !== "object" || e === null) return false;
        if (typeof (e as Record<string, unknown>).name !== "string") return false;
      }
    }
  }
  return true;
}

/**
 * Bulk-insert a parsed JSON payload into programs + program_days +
 * program_blocks + program_exercises, all owned by the caller. The payload is
 * parsed client-side; this action receives the already-parsed object.
 */
export async function importProgram(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!validatePayload(payload)) return { ok: false, error: "Invalid program payload" };

  // 1) Program (owned + private).
  const { data: prog, error: progErr } = await supabase
    .from("programs")
    .insert({
      owner_id: user.id,
      is_public: false,
      name: payload.program.name,
      source: payload.program.source ?? "custom",
    })
    .select("id")
    .single();
  if (progErr || !prog) return { ok: false, error: progErr?.message ?? "Insert failed" };
  const programId = prog.id as string;

  // 2) Days, then blocks per day, then exercise rows per block. Order is the
  //    array index so a round-tripped export preserves sequence.
  for (let di = 0; di < payload.days.length; di++) {
    const d = payload.days[di];
    const { data: dayRow, error: dayErr } = await supabase
      .from("program_days")
      .insert({
        program_id: programId,
        phase: d.phase ?? 1,
        week: d.week ?? 1,
        day: d.day ?? di + 1,
        title: d.title,
        est_minutes: d.est_minutes ?? null,
        video_url: d.video_url ?? null,
        order: di,
      })
      .select("id")
      .single();
    if (dayErr || !dayRow) return { ok: false, error: dayErr?.message ?? "Day insert failed" };
    const dayId = dayRow.id as string;

    for (let bi = 0; bi < d.blocks.length; bi++) {
      const b = d.blocks[bi];
      const { data: blockRow, error: blockErr } = await supabase
        .from("program_blocks")
        .insert({
          program_day_id: dayId,
          label: b.label,
          type: b.type ?? "other",
          detail: b.detail ?? null,
          order: bi,
        })
        .select("id")
        .single();
      if (blockErr || !blockRow) {
        return { ok: false, error: blockErr?.message ?? "Block insert failed" };
      }
      const blockId = blockRow.id as string;

      if (b.exercises.length) {
        const rows = b.exercises.map((e, ei) => ({
          program_block_id: blockId,
          name: e.name,
          sets: e.sets ?? null,
          reps: e.reps ?? null,
          load: e.load ?? null,
          distance: e.distance ?? null,
          time: e.time ?? null,
          rest: e.rest ?? null,
          notes: e.notes ?? null,
          order: ei,
        }));
        const { error: exErr } = await supabase.from("program_exercises").insert(rows);
        if (exErr) return { ok: false, error: exErr.message };
      }
    }
  }

  revalidateProgramRoutes();
  return { ok: true, data: { id: programId } };
}

/**
 * Export a program (with its days, blocks, and exercise rows) as the same JSON
 * shape `importProgram` accepts, so the two round-trip. RLS lets the caller
 * read public-or-owned programs.
 */
export async function exportProgram(
  programId: string,
): Promise<ActionResult<ProgramExportPayload>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: program, error: progErr } = await supabase
    .from("programs")
    .select("name, source")
    .eq("id", programId)
    .maybeSingle();
  if (progErr) return { ok: false, error: progErr.message };
  if (!program) return { ok: false, error: "Program not found" };

  const { data: days, error: daysErr } = await supabase
    .from("program_days")
    .select("id, phase, week, day, title, est_minutes, video_url, order")
    .eq("program_id", programId)
    .order("order", { ascending: true });
  if (daysErr) return { ok: false, error: daysErr.message };

  const dayIds = (days ?? []).map((d) => d.id as string);

  // Fetch all blocks + exercises for the program's days in two queries, then
  // group in memory (avoids N+1 round-trips per day/block).
  const { data: blocks, error: blocksErr } = dayIds.length
    ? await supabase
        .from("program_blocks")
        .select("id, program_day_id, label, type, detail, order")
        .in("program_day_id", dayIds)
        .order("order", { ascending: true })
    : { data: [] as Record<string, unknown>[], error: null };
  if (blocksErr) return { ok: false, error: blocksErr.message };

  const blockIds = (blocks ?? []).map((b) => b.id as string);
  const { data: exercises, error: exErr } = blockIds.length
    ? await supabase
        .from("program_exercises")
        .select("program_block_id, name, sets, reps, load, distance, time, rest, notes, order")
        .in("program_block_id", blockIds)
        .order("order", { ascending: true })
    : { data: [] as Record<string, unknown>[], error: null };
  if (exErr) return { ok: false, error: exErr.message };

  const exByBlock = new Map<string, ProgramExportExercise[]>();
  for (const e of exercises ?? []) {
    const key = e.program_block_id as string;
    const arr = exByBlock.get(key) ?? [];
    arr.push({
      name: e.name as string,
      sets: (e.sets as number | null) ?? null,
      reps: (e.reps as string | null) ?? null,
      load: (e.load as string | null) ?? null,
      distance: (e.distance as string | null) ?? null,
      time: (e.time as string | null) ?? null,
      rest: (e.rest as string | null) ?? null,
      notes: (e.notes as string | null) ?? null,
    });
    exByBlock.set(key, arr);
  }

  const blocksByDay = new Map<string, ProgramExportBlock[]>();
  for (const b of blocks ?? []) {
    const key = b.program_day_id as string;
    const arr = blocksByDay.get(key) ?? [];
    arr.push({
      label: b.label as string,
      type: (b.type as BlockType | null) ?? null,
      detail: (b.detail as string | null) ?? null,
      exercises: exByBlock.get(b.id as string) ?? [],
    });
    blocksByDay.set(key, arr);
  }

  const payload: ProgramExportPayload = {
    program: {
      name: program.name as string,
      source: (program.source as string | undefined) ?? "custom",
    },
    days: (days ?? []).map((d) => ({
      phase: (d.phase as number | undefined) ?? 1,
      week: (d.week as number | undefined) ?? 1,
      day: (d.day as number | undefined) ?? 1,
      title: d.title as string,
      est_minutes: (d.est_minutes as number | null) ?? null,
      video_url: (d.video_url as string | null) ?? null,
      blocks: blocksByDay.get(d.id as string) ?? [],
    })),
  };

  return { ok: true, data: payload };
}
