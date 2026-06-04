import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { SectionHeader } from "@/components/ui";
import {
  ProgramsProvider,
  NewProgramButton,
  ProgramsView,
  type ProgramCard,
  type ActionResult,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   PROGRAMS (/programs) — gaps 5, 6, 9.
   Two sections:
     • My Programs — owned programs with Edit / Delete + an ACTIVE badge.
     • Templates / Public — public/seed programs with Enroll and
       "Make a copy I can edit" (clone → route to the new program).
   Plus a "New Program" button and an Import link. The user's active
   enrollment is surfaced so they can see which program drives Today.

   Self-contained: this server page reads programs + the active enrollment
   directly via the async Supabase client; the interactive cards receive the
   server actions defined below as props.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Server actions (passed to the client view as props) ─────────────── */

async function createProgram(name: string): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const { data, error } = await supabase
    .from("programs")
    .insert({ name: trimmed, source: "custom", owner_id: user.id, is_public: false })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create." };

  revalidatePath("/programs");
  return { ok: true, data: { id: data.id as string } };
}

async function deleteProgram(id: string): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("programs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/programs");
  revalidatePath("/today");
  return { ok: true };
}

/** Enroll into a program (set it active; pause any other active enrollment).
 *  Also seeds the scheduler cursor to the program's first day. */
async function enrollInProgram(programId: string): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // Pause other active enrollments first (a partial unique index allows only
  // one 'active' row per user).
  await supabase
    .from("program_enrollments")
    .update({ status: "paused" })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("program_id", programId);

  // First day of the program for the scheduler cursor.
  const { data: firstDay } = await supabase
    .from("program_days")
    .select("id")
    .eq("program_id", programId)
    .order("phase", { ascending: true })
    .order("week", { ascending: true })
    .order("day", { ascending: true })
    .order("order", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("program_enrollments").upsert(
    {
      user_id: user.id,
      program_id: programId,
      status: "active",
      current_day_id: (firstDay?.id as string) ?? null,
    },
    { onConflict: "user_id,program_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/programs");
  revalidatePath("/today");
  return { ok: true };
}

/** Deep-copy a public/template program into an editable copy I own. */
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

export default async function ProgramsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let mine: ProgramCard[] = [];
  let templates: ProgramCard[] = [];
  let activeProgramId: string | null = null;

  if (user) {
    const [{ data: owned }, { data: pub }, { data: enrollment }] = await Promise.all([
      supabase
        .from("programs")
        .select("id, name, source, owner_id, is_public, created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("programs")
        .select("id, name, source, owner_id, is_public, created_at")
        .eq("is_public", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("program_enrollments")
        .select("program_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    mine = (owned ?? []) as ProgramCard[];
    activeProgramId = (enrollment?.program_id as string) ?? null;

    // Public list excludes programs the user already owns to avoid duplicates.
    const ownedIds = new Set(mine.map((p) => p.id));
    templates = ((pub ?? []) as ProgramCard[]).filter((p) => !ownedIds.has(p.id));

    // Day counts (for "N days" meta), fetched in one pass per section.
    const allIds = [...mine, ...templates].map((p) => p.id);
    if (allIds.length) {
      const { data: days } = await supabase
        .from("program_days")
        .select("program_id")
        .in("program_id", allIds);
      const counts = new Map<string, number>();
      for (const d of (days ?? []) as Array<{ program_id: string }>) {
        counts.set(d.program_id, (counts.get(d.program_id) ?? 0) + 1);
      }
      const apply = (p: ProgramCard) => ({ ...p, dayCount: counts.get(p.id) ?? 0 });
      mine = mine.map(apply);
      templates = templates.map(apply);
    }
  }

  return (
    <ProgramsProvider
      createAction={createProgram}
      deleteAction={deleteProgram}
      enrollAction={enrollInProgram}
      cloneAction={cloneProgram}
    >
      <header className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            Author &amp; manage
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Programs
          </h1>
        </div>
        <NewProgramButton />
      </header>

      <SectionHeader
        action={
          <Link href="/programs/import" className="text-gold">
            Import
          </Link>
        }
      >
        Library
      </SectionHeader>

      <ProgramsView
        mine={mine}
        templates={templates}
        activeProgramId={activeProgramId}
      />
    </ProgramsProvider>
  );
}
