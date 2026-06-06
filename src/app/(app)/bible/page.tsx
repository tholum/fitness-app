import Link from "next/link";
import { Card, SectionHeader } from "@/components/ui";
import {
  getBibleTracker,
  getWeeklyProgress,
  getTrackerStreak,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { weekDates, weekdayLabel, todayISO } from "@/lib/format";
import { readPlanRef, resolveTodaysReading } from "@/lib/biblePlans";
import {
  BibleProvider,
  SchedulePill,
  BibleLink,
  BibleBlockButton,
  MarkReadButton,
  WeekDayToggle,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   BIBLE READING screen (/bible) — Phase 3, first-class.

   The dedicated daily reading experience built on the foundation's bible
   singleton tracker (type 'bible'):
     • Streak hero — current reading streak (consecutive days for
       daily_binary, consecutive scheduled days for specific_weekdays).
     • Today's reading card — when a built-in plan is attached
       (config.plan = { id, name, startDate }), suggests today's passage
       (lib/biblePlans). Otherwise a simple "mark read".
     • Week strip — 7 tappable Mon→Sun dots, each toggling that day's
       read-log via logTracker / unlogTracker (one tracker_logs row/day).
     • Schedule editor + plan picker (portaled sheets in _components).

   Daily logging REUSES tracker_logs through logTracker/unlogTracker — no
   new schema. Weekly progress comes from getWeeklyProgress(bibleTracker).
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function BiblePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tracker = user ? await getBibleTracker(user.id) : null;

  // Which days this week already have a read-log (Mon→Sun aligned).
  const week = weekDates(); // 7 ISO dates, Monday-first
  const today = todayISO();
  let loggedSet = new Set<string>();
  if (tracker) {
    const { data: logs } = await supabase
      .from("tracker_logs")
      .select("date")
      .eq("tracker_id", tracker.id)
      .gte("date", week[0])
      .lte("date", week[6]);
    loggedSet = new Set((logs ?? []).map((r) => r.date as string));
  }

  const progress = tracker ? await getWeeklyProgress(tracker, user?.id) : null;
  const streak = tracker ? await getTrackerStreak(tracker) : 0;

  // Today's plan reading (if a plan is attached).
  const planRef = readPlanRef(tracker?.config);
  const reading = resolveTodaysReading(planRef, today);

  const doneToday = loggedSet.has(today);
  const readCount = week.filter((d) => loggedSet.has(d)).length;

  // Scheduled-but-unmet styling for specific_weekdays (Mon-first booleans).
  const scheduledMon = progress?.scheduledWeekdays ?? null;

  const dateLabel = `${weekdayLabel(new Date(), true)}, ${new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  })}`;

  return (
    <BibleProvider tracker={tracker}>
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            {dateLabel}
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Bible Reading
          </h1>
        </div>
        {tracker ? <SchedulePill /> : null}
      </div>

      {/* ── No tracker yet → first-run setup ── */}
      {!tracker ? (
        <Card className="mb-3.5 p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-line bg-surface2 [&_svg]:h-7 [&_svg]:w-7 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.8]">
            <svg viewBox="0 0 24 24">
              <path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM18 3v18M9 7h5M9 10h5" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold uppercase tracking-[0.03em] text-text">
            Start a reading habit
          </h2>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-muted">
            Read daily or on set weekdays, build a streak, and (optionally) follow
            a plan that suggests today&apos;s passage.
          </p>
          <div className="mt-4">
            <BibleBlockButton kind="schedule">Set Up Reading</BibleBlockButton>
          </div>
        </Card>
      ) : null}

      {/* ── Streak hero ── */}
      {tracker ? (
        <Card className="mb-3.5 overflow-hidden p-0">
          <div className="bg-grad px-5 py-6 text-bg">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[20px] bg-bg/15 [&_svg]:h-8 [&_svg]:w-8 [&_svg]:fill-none [&_svg]:stroke-bg [&_svg]:[stroke-width:1.8]">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3c1 3 4 4 4 8a4 4 0 11-8 0c0-2 1-3 2-4 1 2 2 2 2 4M12 3c-1 2-3 3-3 6" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="font-display text-[44px] font-bold leading-none">
                  {streak}
                </div>
                <div className="font-cond text-[11px] font-semibold uppercase tracking-[0.14em] text-bg/80">
                  {streak === 1 ? "day streak" : "day streak"}
                  {tracker.cadence_type === "specific_weekdays" ? " · scheduled days" : ""}
                </div>
              </div>
            </div>
            <p className="mt-4 font-cond text-[11px] uppercase tracking-wide text-bg/80">
              {readCount} of 7 days read this week
            </p>
          </div>

          {/* Week strip — tappable Mon→Sun day toggles */}
          <div className="px-4 py-4">
            <div className="flex gap-1.5">
              {week.map((d, i) => (
                <WeekDayToggle
                  key={d}
                  date={d}
                  label={weekdayLabel(d)}
                  filled={loggedSet.has(d)}
                  scheduled={scheduledMon?.[i] ?? false}
                  isToday={d === today}
                />
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Today's reading card ── */}
      {tracker ? (
        <>
          <SectionHeader action={<BibleLink kind="plan">{planRef ? "Change" : "Add plan"}</BibleLink>}>
            Today&apos;s Reading
          </SectionHeader>
          <Card className="mb-3.5 p-5">
            {reading ? (
              <>
                <div className="font-cond text-[11px] uppercase tracking-[0.14em] text-gold">
                  {reading.plan.name} · Day {reading.dayNumber} of {reading.total}
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold leading-tight text-text">
                  {reading.passage}
                </div>
                {reading.notStarted ? (
                  <p className="mt-1.5 font-cond text-[11px] uppercase tracking-wide text-faint">
                    Plan starts later — this is your first passage.
                  </p>
                ) : reading.finished ? (
                  <p className="mt-1.5 font-cond text-[11px] uppercase tracking-wide text-faint">
                    Plan complete — keep going or pick a new one.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="font-display text-xl font-bold leading-tight text-text">
                  {doneToday ? "Read for today" : "Open your Bible"}
                </div>
                <p className="mt-1.5 text-[13px] text-muted">
                  No plan attached — read freely and mark the day when you&apos;re done.
                  Or{" "}
                  <BibleLink kind="plan">follow a plan</BibleLink>{" "}
                  for a daily passage.
                </p>
              </>
            )}

            <div className="mt-4">
              <MarkReadButton
                date={today}
                done={doneToday}
                label={reading ? "Mark Read" : "Mark Read Today"}
              />
            </div>
          </Card>
        </>
      ) : null}

      {/* ── Schedule summary ── */}
      {tracker ? (
        <>
          <SectionHeader action={<BibleLink kind="schedule">Edit</BibleLink>}>
            Schedule
          </SectionHeader>
          <Card className="mb-3.5 flex items-center gap-[13px] p-3.5">
            <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px] border border-line bg-surface2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.9]">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 9h18M8 2v4M16 2v4" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
                {tracker.cadence_type === "specific_weekdays" ? "Specific Days" : "Every Day"}
              </div>
              <div className="truncate text-xs text-muted">
                {tracker.cadence_type === "specific_weekdays"
                  ? scheduleDaysLabel(tracker.scheduled_weekdays)
                  : "A daily reading streak"}
              </div>
            </div>
          </Card>
        </>
      ) : null}

      {/* Coherence: back to the unified goals dashboard. */}
      <Link
        href="/today"
        className="mt-2 flex items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        Back to Today
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </BibleProvider>
  );
}

/** Human label for committed weekdays (Postgres dow 0=Sun..6=Sat), Mon-first. */
function scheduleDaysLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "No days set";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const set = new Set(days);
  return order
    .filter((d) => set.has(d))
    .map((d) => names[d])
    .join(" · ");
}
