import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validateVideoUrl } from "@/lib/format";
import { SectionHeader } from "@/components/ui";
import {
  ImportPanel,
  ExportPanel,
  type ImportPayload,
  type ExportableProgram,
  type ProgramExport,
  type ActionResult,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   IMPORT / EXPORT (/programs/import) — gap 8.
   Desktop-first: upload a .json file, parse it client-side, preview the
   program → days → blocks → exercises tree, then POST the parsed payload to
   importProgram. Also export an owned program to a downloadable JSON file
   (exportProgram). The accepted schema is documented in-page.

   Self-contained: this server page lists the user's owned programs (for the
   export picker) and defines the import/export server actions, passed to the
   client panels as props.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const BLOCK_TYPES = ["warmup", "strength", "conditioning", "mobility", "other"];

/* ── helpers ─────────────────────────────────────────────────────────── */
function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asIntOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function asInt(v: unknown, fallback: number): number {
  const n = asIntOrNull(v);
  return n == null ? fallback : n;
}
function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

/* ── Server action: import a parsed payload ──────────────────────────── */

async function importProgram(
  payload: ImportPayload,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = asStr(payload?.name).trim();
  if (!name) return { ok: false, error: "The file is missing a program name." };
  if (!Array.isArray(payload.days)) {
    return { ok: false, error: "The file is missing a 'days' array." };
  }

  // 1) program
  const { data: program, error: pErr } = await supabase
    .from("programs")
    .insert({
      name,
      source: asStr(payload.source, "custom") || "custom",
      owner_id: user.id,
      is_public: false,
    })
    .select("id")
    .single();
  if (pErr || !program) return { ok: false, error: pErr?.message ?? "Could not create program." };
  const programId = program.id as string;

  // 2) days → blocks → exercises
  for (let di = 0; di < payload.days.length; di++) {
    const d = payload.days[di] ?? {};
    const { data: dayRow, error: dErr } = await supabase
      .from("program_days")
      .insert({
        program_id: programId,
        phase: asInt(d.phase, 1),
        week: asInt(d.week, 1),
        day: asInt(d.day, di + 1),
        title: asStr(d.title, `Day ${di + 1}`),
        est_minutes: asIntOrNull(d.est_minutes),
        // Stored XSS hardening: only accept https:// mtntough.com links.
        // Anything else (javascript:, data:, http:, other hosts) is dropped
        // to null so it can never be rendered as a dangerous anchor href.
        video_url: validateVideoUrl(d.video_url),
        order: asInt(d.order, di),
      })
      .select("id")
      .single();
    if (dErr || !dayRow) {
      // Best-effort cleanup so a half-import doesn't linger.
      await supabase.from("programs").delete().eq("id", programId).eq("owner_id", user.id);
      return { ok: false, error: dErr?.message ?? "Could not import a day." };
    }
    const dayId = dayRow.id as string;

    const blocks = Array.isArray(d.blocks) ? d.blocks : [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi] ?? {};
      const type = BLOCK_TYPES.includes(asStr(b.type)) ? asStr(b.type) : "strength";
      const { data: blockRow, error: bErr } = await supabase
        .from("program_blocks")
        .insert({
          program_day_id: dayId,
          label: asStr(b.label, `Block ${bi + 1}`),
          type,
          detail: clean(b.detail),
          order: asInt(b.order, bi),
        })
        .select("id")
        .single();
      if (bErr || !blockRow) {
        await supabase.from("programs").delete().eq("id", programId).eq("owner_id", user.id);
        return { ok: false, error: bErr?.message ?? "Could not import a block." };
      }
      const blockId = blockRow.id as string;

      const exercises = Array.isArray(b.exercises) ? b.exercises : [];
      if (exercises.length) {
        const rows = exercises.map((x, xi) => ({
          program_block_id: blockId,
          // Imported rows are custom by default (library ids won't match a
          // fresh account); name is what carries over.
          exercise_id: null,
          name: asStr(x?.name, `Exercise ${xi + 1}`),
          sets: asIntOrNull(x?.sets),
          reps: clean(x?.reps),
          load: clean(x?.load),
          distance: clean(x?.distance),
          time: clean(x?.time),
          rest: clean(x?.rest),
          notes: clean(x?.notes),
          order: asInt(x?.order, xi),
        }));
        const { error: xErr } = await supabase.from("program_exercises").insert(rows);
        if (xErr) {
          await supabase.from("programs").delete().eq("id", programId).eq("owner_id", user.id);
          return { ok: false, error: xErr.message };
        }
      }
    }
  }

  revalidatePath("/programs");
  return { ok: true, data: { id: programId } };
}

/* ── Server action: export an owned program to a JSON-able tree ──────── */

async function exportProgram(
  programId: string,
): Promise<ActionResult<{ program: ProgramExport }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, source, owner_id")
    .eq("id", programId)
    .maybeSingle();
  if (!program) return { ok: false, error: "Program not found." };
  if (program.owner_id !== user.id) {
    return { ok: false, error: "You can only export programs you own." };
  }

  const { data: days } = await supabase
    .from("program_days")
    .select("id, phase, week, day, title, est_minutes, video_url, order")
    .eq("program_id", programId)
    .order("order", { ascending: true });
  const dayList = (days ?? []) as Array<{
    id: string;
    phase: number;
    week: number;
    day: number;
    title: string;
    est_minutes: number | null;
    video_url: string | null;
    order: number;
  }>;

  const dayIds = dayList.map((d) => d.id);
  const blocksByDay = new Map<string, Array<{ id: string; label: string; type: string; detail: string | null; order: number }>>();
  if (dayIds.length) {
    const { data: blocks } = await supabase
      .from("program_blocks")
      .select("id, program_day_id, label, type, detail, order")
      .in("program_day_id", dayIds)
      .order("order", { ascending: true });
    for (const b of (blocks ?? []) as Array<{
      id: string;
      program_day_id: string;
      label: string;
      type: string;
      detail: string | null;
      order: number;
    }>) {
      const list = blocksByDay.get(b.program_day_id) ?? [];
      list.push({ id: b.id, label: b.label, type: b.type, detail: b.detail, order: b.order });
      blocksByDay.set(b.program_day_id, list);
    }
  }

  const allBlockIds = [...blocksByDay.values()].flat().map((b) => b.id);
  const exByBlock = new Map<string, Array<Record<string, unknown>>>();
  if (allBlockIds.length) {
    const { data: rows } = await supabase
      .from("program_exercises")
      .select("program_block_id, name, sets, reps, load, distance, time, rest, notes, order")
      .in("program_block_id", allBlockIds)
      .order("order", { ascending: true });
    for (const r of (rows ?? []) as Array<Record<string, unknown> & { program_block_id: string }>) {
      const { program_block_id, ...rest } = r;
      const list = exByBlock.get(program_block_id) ?? [];
      list.push(rest);
      exByBlock.set(program_block_id, list);
    }
  }

  const exported: ProgramExport = {
    name: program.name as string,
    source: program.source as string,
    days: dayList.map((d) => ({
      phase: d.phase,
      week: d.week,
      day: d.day,
      title: d.title,
      est_minutes: d.est_minutes,
      video_url: d.video_url,
      order: d.order,
      blocks: (blocksByDay.get(d.id) ?? []).map((b) => ({
        label: b.label,
        type: b.type,
        detail: b.detail,
        order: b.order,
        exercises: exByBlock.get(b.id) ?? [],
      })),
    })),
  };

  return { ok: true, data: { program: exported } };
}

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let owned: ExportableProgram[] = [];
  if (user) {
    const { data } = await supabase
      .from("programs")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    owned = (data ?? []) as ExportableProgram[];
  }

  return (
    <>
      <header className="relative z-10 px-0.5 pb-3 pt-2">
        <Link
          href="/programs"
          className="mb-2 inline-flex items-center gap-1 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.2]"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Programs
        </Link>
        <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
          Import / Export
        </h1>
        <div className="mt-1.5 font-cond text-[11px] uppercase tracking-[0.12em] text-muted">
          Desktop-first · plain JSON
        </div>
      </header>

      <SectionHeader>Import a Plan</SectionHeader>
      <ImportPanel importAction={importProgram} />

      <SectionHeader>Export a Program</SectionHeader>
      <ExportPanel programs={owned} exportAction={exportProgram} />
    </>
  );
}
