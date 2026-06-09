import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getTodaySession,
  getCrewToday,
  getProgram,
  resolveTodayDay,
} from "@/lib/queries";
import { StatPill } from "@/components/ui";
import { validateVideoUrl, weekdayLabel } from "@/lib/format";
import type {
  BlockType,
  Json,
  Program,
  ProgramBlock,
  ProgramDay,
} from "@/lib/types";
import { CheckinClient, type CheckinBlock } from "./_components";

/* ════════════════════════════════════════════════════════════════════
   CHECK IN — server page (completion-first).
   Loads today's session (or, on a fresh day, the SCHEDULED program day
   from the user's active enrollment via resolveTodayDay) and hands a
   normalized checklist to the interactive client. The scheduled day comes
   from the enrollment's current_day_id, which advances as sessions
   complete — not from a global first-program heuristic. Marking complete
   writes session_logs + block_completions (with per-block detail) and
   optionally posts a feed_post, then routes back to /today.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Local helpers (kept here rather than editing shared queries) ─────── */

/** Human sub-label for a completion row: prefer a structured payload summary,
 *  else the matching program block's text detail (by order). */
function deriveDetail(
  payload: Json | null | undefined,
  programDetail: string | null | undefined,
): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, Json | undefined>;
    const parts: string[] = [];
    if (typeof rec.summary === "string" && rec.summary) return rec.summary;
    if (rec.weight != null) parts.push(`${String(rec.weight)} lb`);
    if (rec.sets != null && rec.reps != null) {
      parts.push(`${String(rec.sets)}×${String(rec.reps)}`);
    }
    if (rec.distance != null) parts.push(`${String(rec.distance)} mi`);
    if (rec.time != null) parts.push(String(rec.time));
    if (parts.length) return parts.join(" · ");
  }
  return programDetail ?? null;
}

function metaLine(day: ProgramDay | null, blockCount: number): string {
  const parts: string[] = [];
  if (day) parts.push(`Phase ${day.phase} · Week ${day.week} · Day ${day.day}`);
  if (day?.est_minutes) parts.push(`~${day.est_minutes} min`);
  parts.push(`${blockCount} ${blockCount === 1 ? "block" : "blocks"}`);
  return parts.join(" · ");
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default async function CheckinPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const [todaySession, crewToday] = await Promise.all([
    getTodaySession(profile.id),
    getCrewToday(profile.id),
  ]);
  const crewId = crewToday.crew?.id ?? null;

  let sessionLogId: string | null = null;
  let programDayId: string | null = null;
  let title = "Today's Session";
  let videoUrl: string | null = null;
  let estMinutes: number | null = null;
  let alreadyComplete = false;
  let scheduledDay: ProgramDay | null = null;
  let program: Program | null = null;
  let blocks: CheckinBlock[] = [];

  if (todaySession) {
    // A session log exists for today (started or completed).
    const { log, blocks: completions } = todaySession;
    sessionLogId = log.id;
    programDayId = log.program_day_id;
    title = log.title;
    estMinutes = log.duration_min;
    alreadyComplete = log.completed;

    // Pull the linked program day (for video_url, meta, block text details).
    let programBlocks: ProgramBlock[] = [];
    if (log.program_day_id) {
      const supabase = await createClient();
      const [{ data: day }, { data: pBlocks }] = await Promise.all([
        supabase
          .from("program_days")
          .select("*")
          .eq("id", log.program_day_id)
          .maybeSingle(),
        supabase
          .from("program_blocks")
          .select("*")
          .eq("program_day_id", log.program_day_id)
          .order("order", { ascending: true }),
      ]);
      scheduledDay = (day as ProgramDay) ?? null;
      videoUrl = scheduledDay?.video_url ?? null;
      if (scheduledDay?.est_minutes && estMinutes == null) {
        estMinutes = scheduledDay.est_minutes;
      }
      // Eyebrow source: the program that owns this scheduled day (name/source),
      // mirroring how Today derives its hero eyebrow.
      if (scheduledDay?.program_id) {
        program = await getProgram(scheduledDay.program_id);
      }
      programBlocks = (pBlocks ?? []) as ProgramBlock[];
    }

    if (completions.length) {
      blocks = completions.map((c, i) => ({
        id: c.id,
        label: c.label,
        type: (c.type as BlockType | null) ?? null,
        detail: deriveDetail(c.detail, programBlocks[i]?.detail),
        done: c.done,
        payload: c.detail,
      }));
    } else {
      // Log exists but no checklist persisted yet → seed from program blocks.
      blocks = programBlocks.map((b) => ({
        id: null,
        label: b.label,
        type: b.type,
        detail: b.detail,
        done: false,
        payload: null,
      }));
    }
  } else {
    // No log yet today → seed the checklist from the user's active enrollment.
    // resolveTodayDay reads the enrollment's current_day_id (which advances as
    // sessions complete), returning the scheduled day + its ordered blocks.
    const today = await resolveTodayDay(profile.id);
    if (today?.day) {
      scheduledDay = today.day;
      program = today.program;
      programDayId = today.day.id;
      title = today.day.title;
      videoUrl = today.day.video_url;
      estMinutes = today.day.est_minutes;
      blocks = today.blocks.map((b) => ({
        id: null,
        label: b.label,
        type: b.type,
        detail: b.detail,
        done: false,
        payload: null,
      }));
    }
  }

  // Re-validate before the value is rendered as the "Watch on MTNTOUGH" href
  // (WatchButton). The 0007 DB CHECK already bounds new writes; this also covers
  // any value predating that migration. Only an https://mtntough.com link
  // survives — anything else (e.g. a javascript: URL) becomes null (no button).
  videoUrl = validateVideoUrl(videoUrl);

  const description = videoUrl
    ? "Follow along on the MTNTOUGH video, then tick off each block as you finish."
    : "Tick off each block as you finish, then mark the session complete.";

  // Header eyebrow: derive from the program like Today's hero does, so a
  // custom program with a video link isn't mislabeled "MTNTOUGH · Backcountry".
  // Without a program, fall back to today's date (like /body's header) so the
  // eyebrow doesn't duplicate the "Check In" h1 right below it.
  const eyebrow =
    program?.source === "MTNTOUGH"
      ? "MTNTOUGH"
      : program?.name ??
        `${weekdayLabel(new Date(), true)}, ${new Date().toLocaleDateString(
          "en-US",
          { month: "long", day: "numeric" },
        )}`;

  return (
    <>
      {/* Header — mirrors the prototype's .hd for the Session screen. */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            {eyebrow}
          </div>
          <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-[0.03em] text-text">
            Check In
          </h1>
        </div>
        {estMinutes || scheduledDay || blocks.length > 0 ? (
          <StatPill>
            {estMinutes ? `~${estMinutes} min` : metaLine(scheduledDay, blocks.length)}
          </StatPill>
        ) : null}
      </div>

      <CheckinClient
        sessionLogId={sessionLogId}
        programDayId={programDayId}
        title={title}
        description={description}
        videoUrl={videoUrl}
        crewId={crewId}
        estMinutes={estMinutes}
        alreadyComplete={alreadyComplete}
        units={profile.units}
        blocks={blocks}
      />
    </>
  );
}
