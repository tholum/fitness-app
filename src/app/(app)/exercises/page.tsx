import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { SectionHeader } from "@/components/ui";
import { validateVideoUrl } from "@/lib/format";
import {
  ExercisesProvider,
  NewExerciseButton,
  ExerciseList,
  type ExerciseRow,
  type ExerciseInput,
  type ActionResult,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   EXERCISE LIBRARY (/exercises) — gap 3.
   Reusable exercises: define once, reference from program rows. Searchable
   list with a category filter; a "New Exercise" bottom-sheet and edit/delete
   capture name / category / default_video_url / cues.

   Self-contained: this server page reads exercises directly via the async
   Supabase client (RLS: public-or-owned reads). The interactive list +
   create/edit sheets live in ./_components and receive the server actions
   defined below as props.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Server actions (passed to the client provider as props) ─────────── */

async function createExercise(
  input: ExerciseInput,
): Promise<ActionResult<{ id: string }>> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const video = cleanVideoUrl(input.defaultVideoUrl);
  if ("error" in video) return { ok: false, error: video.error };

  const { data, error } = await supabase
    .from("exercises")
    .insert({
      owner_id: user.id,
      is_public: input.isPublic ?? false,
      name,
      category: input.category,
      default_video_url: video.url,
      cues: clean(input.cues),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save." };

  revalidatePath("/exercises");
  return { ok: true, data: { id: data.id as string } };
}

async function updateExercise(
  id: string,
  input: ExerciseInput,
): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const video = cleanVideoUrl(input.defaultVideoUrl);
  if ("error" in video) return { ok: false, error: video.error };

  const { error } = await supabase
    .from("exercises")
    .update({
      name,
      category: input.category,
      default_video_url: video.url,
      cues: clean(input.cues),
      is_public: input.isPublic ?? false,
    })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/exercises");
  return { ok: true };
}

async function deleteExercise(id: string): Promise<ActionResult> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("exercises")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/exercises");
  return { ok: true };
}

/** Trim a string field down to null when blank. */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

/**
 * Validate an optional video URL before storing it. A blank value is allowed
 * (yields `{ url: null }`); a non-blank value MUST pass `validateVideoUrl`
 * (https mtntough.com link only). This blocks stored XSS via `javascript:`/
 * `data:` schemes, which would otherwise execute when the value is rendered
 * as an anchor href in the (public, cross-user readable) exercise list.
 * Returns `{ error }` instead of silently dropping a bad link so the user
 * gets feedback rather than confusing data loss.
 */
function cleanVideoUrl(
  v: string | null | undefined,
): { url: string | null } | { error: string } {
  if (clean(v) == null) return { url: null };
  const url = validateVideoUrl(v);
  if (url == null) {
    return { error: "Video link must be a valid https://mtntough.com URL." };
  }
  return { url };
}

export default async function ExercisesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let exercises: ExerciseRow[] = [];
  if (user) {
    const { data } = await supabase
      .from("exercises")
      .select("id, owner_id, is_public, name, category, default_video_url, cues")
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    exercises = (data ?? []) as ExerciseRow[];
  }

  const myId = user?.id ?? null;

  return (
    <ExercisesProvider
      createAction={createExercise}
      updateAction={updateExercise}
      deleteAction={deleteExercise}
    >
      <header className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            Reusable library
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Exercises
          </h1>
        </div>
        <NewExerciseButton />
      </header>

      <SectionHeader>Your Movements</SectionHeader>
      <ExerciseList exercises={exercises} myId={myId} />
    </ExercisesProvider>
  );
}
