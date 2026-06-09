import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, SectionHeader } from "@/components/ui";
import { WeeklyProgress, type WeeklyProgressData } from "@/components/WeeklyProgress";
import { createClient } from "@/lib/supabase/server";
import { getTrackersForDashboard } from "@/lib/queries";
import { TYPE_LABEL, trackerHref, trackerIcon } from "@/lib/trackerNav";
import type { Tracker, TrackerType } from "@/lib/types";

/* ════════════════════════════════════════════════════════════════════
   GOALS HUB (/goals) — Phase 6.

   The single entry point for every goal area. The four FIRST-CLASS areas
   (Training, Nutrition, Bible, Custom) each get a tile that deep-links into
   its dedicated screen (Phases 2–5). Below, the user's ACTIVE goals are
   listed with the shared <WeeklyProgress> at a glance, each deep-linking to
   the right screen. The unified weekly dashboard lives on Today; this hub is
   the navigational home (IA = both: dashboard + dedicated screens).

   Server component: loads every tracker with this-week progress in one call
   (getTrackersWithProgress), then groups by type for the area tiles.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const AREAS: ReadonlyArray<{
  type: TrackerType;
  title: string;
  sub: string;
}> = [
  { type: "exercise", title: "Training", sub: "Weekly schedule & streak" },
  { type: "diet", title: "Nutrition", sub: "Macros & adherence" },
  { type: "bible", title: "Bible Reading", sub: "Daily reading & streak" },
  { type: "custom", title: "Custom Trackers", sub: "Any habit, any cadence" },
];

export default async function GoalsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Every active goal with this-week progress AND its streak, batched together
  // (≤3 progress queries + 1 streak query). Exercise streak = profile streak.
  const withStreak = await getTrackersForDashboard(user.id);

  const byType = new Map<TrackerType, typeof withStreak>();
  for (const row of withStreak) {
    const list = byType.get(row.tracker.type) ?? [];
    list.push(row);
    byType.set(row.tracker.type, list);
  }

  return (
    <>
      {/* Header */}
      <header className="relative z-10 px-0.5 pb-[18px] pt-2">
        <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
          Everything you&apos;re tracking
        </div>
        <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-[0.03em] text-text">
          Goals
        </h1>
      </header>

      {/* ── Area tiles — the four first-class destinations ── */}
      <SectionHeader>Areas</SectionHeader>
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        {AREAS.map((area) => {
          const count = byType.get(area.type)?.length ?? 0;
          return (
            <Link
              key={area.type}
              href={trackerHref(area.type)}
              className="rounded-card border border-line bg-surface p-4 backdrop-blur-md"
            >
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-[13px] border border-line bg-surface2 text-xl">
                {trackerIcon(area.type, null)}
              </div>
              <div className="font-display text-[14px] font-bold uppercase tracking-[0.03em] text-text">
                {area.title}
              </div>
              <div className="mt-0.5 font-cond text-[10px] uppercase tracking-wide text-faint">
                {count > 0
                  ? `${count} active`
                  : area.type === "custom"
                    ? "Add a habit"
                    : "Set it up"}
              </div>
            </Link>
          );
        })}
      </div>

      {/* ── This week — every active goal at a glance ── */}
      <SectionHeader>This Week</SectionHeader>
      {withStreak.length === 0 ? (
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-line bg-surface2 text-2xl">
            🎯
          </div>
          <h2 className="font-display text-xl font-bold uppercase tracking-[0.03em] text-text">
            No goals yet
          </h2>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-muted">
            Pick an area above to get started — set a training schedule, macro
            targets, a reading habit, or build a custom tracker.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {withStreak.map(({ tracker, progress }) => (
            <GoalRow key={tracker.id} tracker={tracker} progress={progress} />
          ))}
        </div>
      )}

      {/* Coherence: the unified weekly dashboard lives on Today. */}
      <Link
        href="/today"
        className="mt-4 flex items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        Weekly dashboard on Today
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </>
  );
}

/** A single goal row: icon + title + cadence type, the shared WeeklyProgress,
 *  deep-linking into the tracker's dedicated screen. */
function GoalRow({
  tracker,
  progress,
}: {
  tracker: Tracker;
  progress: WeeklyProgressData;
}) {
  return (
    <Link href={trackerHref(tracker.type)} className="block">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface2 text-lg">
            {trackerIcon(tracker.type, tracker.icon)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[14px] font-bold uppercase tracking-[0.03em] text-text">
              {tracker.title}
            </div>
            <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
              {TYPE_LABEL[tracker.type].toLowerCase() !==
              tracker.title.trim().toLowerCase()
                ? TYPE_LABEL[tracker.type]
                : null}
              {progress.streak > 0 ? (
                <span className="ml-2 text-gold">🔥 {progress.streak}</span>
              ) : null}
            </div>
          </div>
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4] text-gold"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
        <WeeklyProgress data={progress} ringSize={48} />
      </Card>
    </Link>
  );
}
