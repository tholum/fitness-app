import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { SectionHeader } from "@/components/ui";
import {
  ProgramTreeProvider,
  ProgramHeader,
  ProgramTree,
  ReadOnlyCloneCTA,
  type DayRow,
  type ActionResult,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   PROGRAM DETAIL (/programs/[id]) — gap 5.
   Phase / Week / Day tree of program_days with add-day, edit/delete,
   drag-reorder, and a link into each day editor. A day-picker sets which
   day counts as "Today" (setCurrentDay). When the program is read-only
   (not owned — e.g. a public seed) editing is hidden and a "Make a copy I
   can edit" CTA is shown.

   Self-contained: this server page reads the program + its days directly
   via the async Supabase client; the interactive tree receives the server
   actions defined below as props.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Server actions (passed to the client tree as props) ─────────────── */

async function createDay(input: {
  programId: string;
  phase: number;
  week: number;
  day: number;
  title: string;
}): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const title = input.title.trim() || "New Day";

  // Append after the current max order for a stable position.
  const { data: last } = await supabase
    .from("program_days")
    .select("order")
    .eq("program_id", input.programId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order as number) ?? -1) + 1;

  const { data, error } = await supabase
    .from("program_days")
    .insert({
      program_id: input.programId,
      phase: input.phase,
      week: input.week,
      day: input.day,
      title,
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add day." };

  revalidatePath(`/programs/${input.programId}`);
  return { ok: true, data: { id: data.id as string } };
}

async function deleteDay(id: string, programId: string): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("program_days").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}`);
  revalidatePath("/today");
  return { ok: true };
}

/** Persist a new ordering for a program's days (array of ids in order). */
async function reorderDays(
  programId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // Update each row's "order" to its index. RLS scopes writes to owned rows.
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("program_days").update({ order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

/** Choose which day counts as "Today" by pointing the active enrollment at
 *  it (enrolling first if needed). gap 5. */
async function setCurrentDay(
  programId: string,
  dayId: string,
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // Ensure this is the active enrollment (pause others), then set the cursor.
  await supabase
    .from("program_enrollments")
    .update({ status: "paused" })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("program_id", programId);

  const { error } = await supabase.from("program_enrollments").upsert(
    {
      user_id: user.id,
      program_id: programId,
      status: "active",
      current_day_id: dayId,
    },
    { onConflict: "user_id,program_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/programs/${programId}`);
  revalidatePath("/today");
  return { ok: true };
}

/** Deep-copy this program into an editable copy I own (read-only CTA). */
async function cloneProgram(srcId: string): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("clone_program", { src: srcId });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not copy." };

  revalidatePath("/programs");
  return { ok: true, data: { id: data as string } };
}

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, source, owner_id, is_public")
    .eq("id", id)
    .maybeSingle();

  if (!program) notFound();

  const readOnly = !user || program.owner_id !== user.id;

  const [{ data: days }, { data: enrollment }] = await Promise.all([
    supabase
      .from("program_days")
      .select("id, phase, week, day, title, est_minutes, video_url, order")
      .eq("program_id", id)
      .order("order", { ascending: true })
      .order("phase", { ascending: true })
      .order("week", { ascending: true })
      .order("day", { ascending: true }),
    user
      ? supabase
          .from("program_enrollments")
          .select("current_day_id, status")
          .eq("user_id", user.id)
          .eq("program_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const dayList = (days ?? []) as DayRow[];

  // Block counts per day (one query once we have the day ids).
  const blockCounts: Record<string, number> = {};
  if (dayList.length) {
    const { data: blocks } = await supabase
      .from("program_blocks")
      .select("program_day_id")
      .in(
        "program_day_id",
        dayList.map((d) => d.id),
      );
    for (const b of (blocks ?? []) as Array<{ program_day_id: string }>) {
      blockCounts[b.program_day_id] = (blockCounts[b.program_day_id] ?? 0) + 1;
    }
  }

  const currentDayId =
    enrollment && enrollment.status === "active"
      ? (enrollment.current_day_id as string | null)
      : null;

  return (
    <ProgramTreeProvider
      programId={id}
      readOnly={readOnly}
      createDayAction={createDay}
      deleteDayAction={deleteDay}
      reorderDaysAction={reorderDays}
      setCurrentDayAction={setCurrentDay}
    >
      <ProgramHeader name={program.name} source={program.source} readOnly={readOnly} />

      {readOnly ? (
        <ReadOnlyCloneCTA programId={id} cloneAction={cloneProgram} />
      ) : null}

      <SectionHeader
        action={
          <Link href="/programs" className="text-gold">
            All programs
          </Link>
        }
      >
        Schedule
      </SectionHeader>

      <ProgramTree
        days={dayList}
        blockCounts={blockCounts}
        currentDayId={currentDayId}
      />
    </ProgramTreeProvider>
  );
}
