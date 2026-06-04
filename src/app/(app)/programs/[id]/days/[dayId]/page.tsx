import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  DayEditor,
  type DayData,
  type BlockData,
  type ExerciseRowData,
  type LibraryExercise,
  type BlockType,
  type ActionResult,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   DAY EDITOR (/programs/[id]/days/[dayId]) — gaps 2, 7.
   Edit the day's fields (title / phase / week / day / est_minutes) and an
   "MTNTOUGH video URL" (validated to contain mtntough.com). Below: a block
   list with CRUD + drag-reorder, and within each block an exercise-row list
   where each row can pick from the reusable library (sets exercise_id +
   name) or type a custom name, plus sets / reps / load / distance / time /
   rest / notes fields.

   Self-contained: this server page reads the day + blocks + exercise rows +
   the library directly via the async Supabase client; the editor receives
   the server actions defined below as props.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const BLOCK_TYPES = [
  "warmup",
  "strength",
  "conditioning",
  "mobility",
  "other",
] as const;

/* ── helpers ─────────────────────────────────────────────────────────── */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

async function ownsDay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  dayId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("program_days")
    .select("program_id, programs!inner(owner_id)")
    .eq("id", dayId)
    .maybeSingle();
  const owner = (data as { programs?: { owner_id: string | null } } | null)?.programs
    ?.owner_id;
  return owner === userId;
}

/* ── Server actions ──────────────────────────────────────────────────── */

async function updateDay(
  dayId: string,
  programId: string,
  input: {
    title: string;
    phase: number;
    week: number;
    day: number;
    estMinutes: number | null;
    videoUrl: string | null;
  },
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  const video = clean(input.videoUrl);
  if (video) {
    let host = "";
    try {
      host = new URL(video).host.toLowerCase();
    } catch {
      return { ok: false, error: "Enter a valid URL (https://…)." };
    }
    if (!host.includes("mtntough.com")) {
      return { ok: false, error: "Video link should be an mtntough.com URL." };
    }
  }

  const { error } = await supabase
    .from("program_days")
    .update({
      title,
      phase: input.phase,
      week: input.week,
      day: input.day,
      est_minutes: input.estMinutes,
      video_url: video,
    })
    .eq("id", dayId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  revalidatePath(`/programs/${programId}`);
  revalidatePath("/today");
  return { ok: true };
}

async function createBlock(
  dayId: string,
  programId: string,
  input: { label: string; type: BlockType; detail: string | null },
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const label = input.label.trim() || "New Block";

  const { data: last } = await supabase
    .from("program_blocks")
    .select("order")
    .eq("program_day_id", dayId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_blocks")
    .insert({
      program_day_id: dayId,
      label,
      type: input.type,
      detail: clean(input.detail),
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add block." };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true, data: { id: data.id as string } };
}

async function updateBlock(
  blockId: string,
  programId: string,
  dayId: string,
  input: { label: string; type: BlockType; detail: string | null },
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const label = input.label.trim() || "Block";
  const { error } = await supabase
    .from("program_blocks")
    .update({ label, type: input.type, detail: clean(input.detail) })
    .eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

async function deleteBlock(
  blockId: string,
  programId: string,
  dayId: string,
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_blocks").delete().eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

async function reorderBlocks(
  programId: string,
  dayId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("program_blocks").update({ order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

export interface ExerciseRowInput {
  exerciseId: string | null;
  name: string;
  sets: number | null;
  reps: string | null;
  load: string | null;
  distance: string | null;
  time: string | null;
  rest: string | null;
  notes: string | null;
}

async function createExerciseRow(
  blockId: string,
  programId: string,
  dayId: string,
  input: ExerciseRowInput,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Exercise name is required." };

  const { data: last } = await supabase
    .from("program_exercises")
    .select("order")
    .eq("program_block_id", blockId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_exercises")
    .insert({
      program_block_id: blockId,
      exercise_id: input.exerciseId,
      name,
      sets: input.sets,
      reps: clean(input.reps),
      load: clean(input.load),
      distance: clean(input.distance),
      time: clean(input.time),
      rest: clean(input.rest),
      notes: clean(input.notes),
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add exercise." };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true, data: { id: data.id as string } };
}

async function updateExerciseRow(
  rowId: string,
  programId: string,
  dayId: string,
  input: ExerciseRowInput,
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Exercise name is required." };

  const { error } = await supabase
    .from("program_exercises")
    .update({
      exercise_id: input.exerciseId,
      name,
      sets: input.sets,
      reps: clean(input.reps),
      load: clean(input.load),
      distance: clean(input.distance),
      time: clean(input.time),
      rest: clean(input.rest),
      notes: clean(input.notes),
    })
    .eq("id", rowId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

async function deleteExerciseRow(
  rowId: string,
  programId: string,
  dayId: string,
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_exercises").delete().eq("id", rowId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

async function reorderExerciseRows(
  programId: string,
  dayId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("program_exercises").update({ order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath(`/programs/${programId}/days/${dayId}`);
  return { ok: true };
}

export default async function DayEditorPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>;
}) {
  const { id: programId, dayId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: day } = await supabase
    .from("program_days")
    .select("id, program_id, phase, week, day, title, est_minutes, video_url")
    .eq("id", dayId)
    .maybeSingle();

  if (!day || day.program_id !== programId) notFound();

  const readOnly = !user || !(await ownsDay(supabase, user.id, dayId));

  // Blocks for this day, then exercise rows for those blocks, then library.
  const { data: blocks } = await supabase
    .from("program_blocks")
    .select("id, label, type, detail, order")
    .eq("program_day_id", dayId)
    .order("order", { ascending: true });

  const blockList = (blocks ?? []) as Array<{
    id: string;
    label: string;
    type: BlockType;
    detail: string | null;
    order: number;
  }>;

  let rowsByBlock: Record<string, ExerciseRowData[]> = {};
  if (blockList.length) {
    const { data: rows } = await supabase
      .from("program_exercises")
      .select(
        "id, program_block_id, exercise_id, name, sets, reps, load, distance, time, rest, notes, order",
      )
      .in(
        "program_block_id",
        blockList.map((b) => b.id),
      )
      .order("order", { ascending: true });
    const grouped: Record<string, ExerciseRowData[]> = {};
    for (const r of (rows ?? []) as ExerciseRowData[]) {
      (grouped[r.program_block_id] ??= []).push(r);
    }
    rowsByBlock = grouped;
  }

  let library: LibraryExercise[] = [];
  if (user) {
    const { data: lib } = await supabase
      .from("exercises")
      .select("id, name, category, default_video_url")
      .order("name", { ascending: true });
    library = (lib ?? []) as LibraryExercise[];
  }

  const dayData: DayData = {
    id: day.id as string,
    program_id: day.program_id as string,
    phase: day.phase as number,
    week: day.week as number,
    day: day.day as number,
    title: day.title as string,
    est_minutes: (day.est_minutes as number | null) ?? null,
    video_url: (day.video_url as string | null) ?? null,
  };

  const blockData: BlockData[] = blockList.map((b) => ({
    id: b.id,
    label: b.label,
    type: b.type,
    detail: b.detail,
    order: b.order,
    rows: rowsByBlock[b.id] ?? [],
  }));

  return (
    <>
      <header className="relative z-10 px-0.5 pb-3 pt-2">
        <Link
          href={`/programs/${programId}`}
          className="mb-2 inline-flex items-center gap-1 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.2]"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to program
        </Link>
      </header>

      <DayEditor
        programId={programId}
        readOnly={readOnly}
        day={dayData}
        blocks={blockData}
        blockTypes={BLOCK_TYPES}
        library={library}
        updateDayAction={updateDay}
        createBlockAction={createBlock}
        updateBlockAction={updateBlock}
        deleteBlockAction={deleteBlock}
        reorderBlocksAction={reorderBlocks}
        createExerciseRowAction={createExerciseRow}
        updateExerciseRowAction={updateExerciseRow}
        deleteExerciseRowAction={deleteExerciseRow}
        reorderExerciseRowsAction={reorderExerciseRows}
      />
    </>
  );
}
