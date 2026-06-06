import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, SectionHeader } from "@/components/ui";
import {
  getTrackers,
  getWeeklyProgress,
  getTrackerStreak,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import type { Tracker } from "@/lib/types";
import type { WeeklyProgressData } from "@/components/WeeklyProgress";
import {
  TrackersProvider,
  NewTrackerButton,
  TrackerCard,
  type TrackerCardData,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   CUSTOM TRACKERS (/trackers) — Phase 5, first-class.

   A list of the user's CUSTOM trackers (type 'custom' — many allowed)
   with full CRUD and per-cadence logging, built entirely on the
   foundation (0010): getTrackers / getWeeklyProgress / getTrackerStreak
   for reads, createTracker / updateTracker / archiveTracker /
   logTracker / unlogTracker for writes (in _components via the provider).

   Every card adapts its logging control to the tracker's cadence:
     • times_per_week    → tick a session today (one log/day toward N/wk)
     • amount_per_week   → quick-add chips accumulate today's amount + unit
     • specific_weekdays → tick today (committed days drive the streak)
     • daily_binary      → tick today (7/wk + a daily streak)

   Each card shows the shared <WeeklyProgress>. The singleton types
   (exercise/diet/bible) live on their own dedicated screens, so this
   screen filters to custom only.

   Server component: resolves the user, loads custom trackers, and
   precomputes each card's progress / today-state / streak in parallel.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function TrackersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const all = await getTrackers(user.id);
  const custom = all.filter((t) => t.type === "custom");

  const today = todayISO();

  // Precompute each card's data in parallel: weekly progress, whether today
  // is logged, today's accumulated amount, and the streak.
  const cards: TrackerCardData[] = await Promise.all(
    custom.map(async (tracker) => {
      const [progress, streak, todayLog] = await Promise.all([
        getWeeklyProgress(tracker, user.id),
        getTrackerStreak(tracker),
        fetchTodayLog(supabase, tracker, today),
      ]);

      const progressData: WeeklyProgressData = {
        done: progress.done,
        target: progress.target,
        unit: progress.unit,
        perDay: progress.perDay,
        streak,
        scheduledWeekdays: progress.scheduledWeekdays,
      };

      return {
        tracker,
        progress: progressData,
        doneToday: todayLog != null,
        todayAmount: todayLog ?? 0,
        streak,
      } satisfies TrackerCardData;
    }),
  );

  return (
    <TrackersProvider>
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            Build any habit
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            My Trackers
          </h1>
        </div>
        {custom.length > 0 ? <NewTrackerButton variant="pill" /> : null}
      </div>

      {/* ── Empty state ── */}
      {custom.length === 0 ? (
        <Card className="mb-3.5 p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-line bg-surface2 text-2xl">
            🎯
          </div>
          <h2 className="font-display text-xl font-bold uppercase tracking-[0.03em] text-text">
            Track anything
          </h2>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-muted">
            Guitar practice, cold showers, reading, mobility — whatever you want
            to stay on. Pick a weekly count, an amount, set weekdays, or build a
            daily streak.
          </p>
          <div className="mt-4">
            <NewTrackerButton variant="block">Create Your First Tracker</NewTrackerButton>
          </div>
        </Card>
      ) : (
        <>
          <SectionHeader>This Week</SectionHeader>
          <div className="space-y-3">
            {cards.map((data) => (
              <TrackerCard key={data.tracker.id} data={data} />
            ))}
          </div>

          {/* Bottom CTA so adding stays reachable after a long list. */}
          <div className="mt-4">
            <NewTrackerButton variant="block" />
          </div>
        </>
      )}

      {/* Coherence: back to Today. */}
      <Link
        href="/today"
        className="mt-4 flex items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        Back to Today
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </TrackersProvider>
  );
}

/**
 * Today's log value for a tracker, or null if today isn't logged. For
 * amount_per_week the value is the accumulated amount; for the other cadences
 * any row means "done today" (value is 1). One row per (tracker, date).
 */
async function fetchTodayLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tracker: Tracker,
  today: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("tracker_logs")
    .select("value")
    .eq("tracker_id", tracker.id)
    .eq("date", today)
    .maybeSingle();
  if (!data) return null;
  return Number((data as { value: number }).value ?? 0) || 0;
}
