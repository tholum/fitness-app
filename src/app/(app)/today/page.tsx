import { type ReactNode } from "react";
import Link from "next/link";

import { Card, Ring, SectionHeader, StatPill } from "@/components/ui";
import { normalizeAppearance } from "@/components/appearance";
import {
  getProfile,
  getTodaySession,
  getCrewToday,
  getBodyToday,
  getActiveEnrollment,
  resolveTodayDay,
  getTrainingScheduleToday,
  getNudges,
  getUnseenNudgeCount,
  getTrackersForDashboard,
} from "@/lib/queries";
import { validateVideoUrl } from "@/lib/format";
import { WeeklyProgress } from "@/components/WeeklyProgress";
import { TYPE_LABEL, trackerHref, trackerIcon } from "@/lib/trackerNav";
import { NudgeInbox } from "../checkin/_components";

/* ════════════════════════════════════════════════════════════════════
   TODAY
   Ported from design-prototypes/variant-4-basecamp (#s-today). Server
   component: reads the profile, the user's ACTIVE ENROLLMENT and the day
   it currently points at (resolveTodayDay → hero eyebrow / meta / video),
   the crew's "trained today" roll-up, and any incoming nudges. Every
   branch renders a graceful empty state so a fresh, unenrolled account
   still looks intentional, and the empty-state CTAs route to /programs so
   the user can pick or build a plan.

   The three home cards (session hero, rings, crew strip) honor the user's
   appearance.widgets preference from Appearance → Home Cards: they render
   in the saved order and disabled cards are omitted. The header, nudge
   inbox, and primary CTA are fixed chrome (not reorderable cards).
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Local helper: deterministic avatar color from the prototype palette ── */
const AVATAR_COLORS = [
  "#7a8b52", // moss
  "#c8622d", // blaze
  "#d9a441", // gold
  "#5a7d8c", // slate
  "#b5483a", // rust
] as const;

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Daily ring targets. The schema has no per-user goals yet, so the Fuel and
// Water rings track sensible athletic defaults; they fill in as the Body
// screen logs land for today.
const FUEL_GOAL_KCAL = 2700;
const WATER_GOAL_ML = 3000;

function pct(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export default async function TodayPage() {
  const profile = await getProfile();

  // Resolve everything in parallel. resolveTodayDay walks the active
  // enrollment's current_day_id; getActiveEnrollment gives us the program
  // name/source for the hero eyebrow even before any session is started.
  const [
    session,
    crew,
    body,
    enrollment,
    today,
    schedule,
    nudges,
    unseenNudges,
    goalRows,
  ] = await Promise.all([
    getTodaySession(profile?.id),
    getCrewToday(profile?.id),
    getBodyToday(profile?.id),
    getActiveEnrollment(profile?.id),
    resolveTodayDay(profile?.id),
    getTrainingScheduleToday(profile?.id),
    getNudges(profile?.id),
    getUnseenNudgeCount(profile?.id),
    // Unified dashboard: every active goal with this week's progress AND its
    // streak, resolved together via batched fetches (folded into this parallel
    // block — no separate streak fan-out / waterfall stage).
    getTrackersForDashboard(profile?.id),
  ]);

  // Phase 4: is TODAY a scheduled training day? In 'days' mode a non-scheduled
  // day is a rest day — it never counts against the streak, so we soften the
  // hero and tell the user. A completed session today always wins (you can
  // still train on a rest day; it just isn't required). `sessionDone` is
  // derived again below for the rings; this read is the same value.
  const isRestDay =
    Boolean(schedule?.isRestDay) && !(session?.log.completed ?? false);

  // The enrollment supplies the program (name/source for the eyebrow);
  // resolveTodayDay supplies the scheduled day + its ordered blocks.
  const program = enrollment?.program ?? null;
  const day = today?.day ?? null;
  const hasEnrollment = Boolean(enrollment);

  // Home-card layout: which cards show on Today and in what order, per the
  // user's Appearance → Home Cards preference (profiles.appearance.widgets).
  const widgetOrder = normalizeAppearance(profile?.appearance).widgets;

  // ── Hero copy ─────────────────────────────────────────────────────────
  // A scheduled day comes from the active enrollment; a started/completed
  // session may exist for today too. Show the hero whenever either exists.
  const hasSession = Boolean(session || day);
  const sessionTitle =
    session?.log.title ?? day?.title ?? "No active program";
  const estMinutes = day?.est_minutes ?? session?.log.duration_min ?? null;
  const blockCount = today?.blocks.length ?? session?.blocks.length ?? 0;
  // Re-validate at render: the value could predate the 0007 DB CHECK (applied
  // via `pnpm db:push`). Only an https://mtntough.com link survives as an href;
  // anything else (e.g. a javascript: URL) falls back to the safe default.
  const videoUrl = validateVideoUrl(day?.video_url);

  const eyebrowSource =
    program?.source === "MTNTOUGH" ? "MTNTOUGH" : program?.name ?? null;
  const phaseLine = day
    ? `Phase ${day.phase} · Week ${day.week} · Day ${day.day}`
    : hasEnrollment
      ? program?.name ?? "Active program"
      : "No active program";

  const metaParts: string[] = [];
  if (program?.name) metaParts.push(program.name);
  if (estMinutes) metaParts.push(`~${estMinutes} min`);
  if (blockCount) metaParts.push(`${blockCount} ${blockCount === 1 ? "block" : "blocks"}`);
  const heroMeta = metaParts.join(" · ");

  // ── Session ring: completed blocks / total (else 0/1 by completion) ────
  const totalBlocks = session?.blocks.length ?? 0;
  const doneBlocks = session?.blocks.filter((b) => b.done).length ?? 0;
  const sessionDone = session?.log.completed ?? false;
  const sessionRingValue =
    totalBlocks > 0 ? doneBlocks / totalBlocks : sessionDone ? 1 : 0;
  const sessionRingLabel =
    totalBlocks > 0 ? `${doneBlocks}/${totalBlocks}` : sessionDone ? "1/1" : "0/1";

  // Fuel + Water rings (graceful 0 when nothing logged today).
  const fuelRingValue = body.kcal / FUEL_GOAL_KCAL;
  const waterRingValue = (body.water?.ml ?? 0) / WATER_GOAL_ML;

  const streak = profile?.streak_count ?? 0;
  // Streak is measured in weeks for the "count" goal, days otherwise (0009).
  const streakUnit = profile?.goal_type === "count" ? "w" : "d";

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[2px] text-muted">
            {phaseLine}
          </div>
          <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-wide text-text">
            Today
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Streak pill — gamification (hidden when that toggle is off). */}
          <StatPill className="gamify-feature">
            🔥 {streak}
            {streak > 0 ? streakUnit : ""}
          </StatPill>
          <Link
            href="/appearance"
            aria-label="Appearance settings"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-none stroke-text [stroke-width:1.8]"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
            </svg>
          </Link>
        </div>
      </header>

      {/* ── Incoming nudges (cooperative; marks them seen on view) ─────────
          Crew & Social feature — hidden when that toggle is off. */}
      <div className="crew-feature">
        <NudgeInbox
          nudges={nudges.map((n) => ({
            id: n.id,
            fromName: n.fromName,
            createdAt: n.created_at,
            seen: n.seen,
          }))}
          unseenCount={unseenNudges}
        />
      </div>

      {/* ── Home cards (order + visibility from appearance.widgets) ──────── */}
      {widgetOrder.map((key) => {
        switch (key) {
          /* ── Hero session card (blaze → gold) ───────────────────────── */
          case "session":
            return (
              <section
                key="session"
                className="relative z-10 mb-3.5 overflow-hidden rounded-[26px] bg-grad p-5 text-bg"
              >
                {/* soft corner highlight */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px]"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,255,255,.28), transparent 70%)",
                  }}
                />
                {/* ridge silhouette */}
                <svg
                  aria-hidden
                  className="pointer-events-none absolute bottom-0 left-0 right-0 opacity-[0.18]"
                  viewBox="0 0 390 100"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points="0,100 0,60 80,30 150,55 230,20 320,50 390,30 390,100"
                    fill="#1c1a17"
                  />
                </svg>

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-cond text-[11px] font-bold uppercase tracking-[2px] opacity-80">
                      Today&apos;s Session{eyebrowSource ? ` · ${eyebrowSource}` : ""}
                    </div>
                    {/* Phase 4: scheduled rest day — never counts against streak. */}
                    {isRestDay ? (
                      <span className="flex-shrink-0 rounded-full bg-[rgba(28,26,23,.18)] px-2.5 py-1 font-cond text-[10px] font-bold uppercase tracking-wide text-bg">
                        Rest day
                      </span>
                    ) : null}
                  </div>
                  <h2 className="my-1 mt-2 font-display text-2xl font-bold uppercase leading-[1.05] tracking-wide">
                    {sessionTitle}
                  </h2>

                  {hasSession ? (
                    <>
                      <div className="text-[13px] font-semibold opacity-85">
                        {isRestDay
                          ? "Scheduled rest day — recover. Missing it won't break your streak."
                          : heroMeta || "Session ready"}
                      </div>
                      <div className="mt-4 flex gap-2.5">
                        <a
                          href={videoUrl ?? "https://mtntough.com"}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex flex-1 items-center justify-center gap-[7px] rounded-[14px] bg-bg p-[13px] font-display text-[13px] font-semibold uppercase tracking-wide text-text ${
                            videoUrl ? "" : "opacity-70"
                          }`}
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Watch on MTNTOUGH
                        </a>
                        <Link
                          href="/checkin"
                          className="flex flex-1 items-center justify-center gap-[7px] rounded-[14px] border-[1.5px] border-[rgba(28,26,23,.4)] bg-[rgba(28,26,23,.15)] p-[13px] font-display text-[13px] font-semibold uppercase tracking-wide text-bg"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4 fill-none stroke-current [stroke-width:3]"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                          Check In
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[13px] font-semibold opacity-85">
                        No active program — browse programs to start training.
                      </div>
                      <div className="mt-4">
                        <Link
                          href="/programs"
                          className="inline-flex items-center justify-center gap-[7px] rounded-[14px] bg-bg px-4 p-[13px] font-display text-[13px] font-semibold uppercase tracking-wide text-text"
                        >
                          Browse programs
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </section>
            );

          /* ── Activity rings ───────────────────────────────────────────
             Gamification surface — hidden when that toggle is off. */
          case "rings":
            return (
              <div
                key="rings"
                className="gamify-feature relative z-10 mb-3.5 flex gap-3"
              >
                <RingCard
                  value={sessionRingValue}
                  color="var(--accent)"
                  centerLabel={null}
                  valueCaption={sessionRingLabel}
                  label="Session"
                />
                <RingCard
                  value={fuelRingValue}
                  color="var(--accent2)"
                  centerLabel={null}
                  valueCaption={pct(fuelRingValue)}
                  label="Fuel"
                />
                <RingCard
                  value={waterRingValue}
                  color="var(--gold)"
                  centerLabel={null}
                  valueCaption={pct(waterRingValue)}
                  label="Water"
                />
              </div>
            );

          /* ── Crew · Today strip ───────────────────────────────────────
             Crew & Social surface — hidden when that toggle is off. */
          case "crew":
            return (
              <div key="crew" className="crew-feature">
                <SectionHeader action={<Link href="/crew">Open Crew →</Link>}>
                  Crew · Today
                </SectionHeader>

                {crew.totalCount > 0 ? (
                  <Link href="/crew" className="block">
                    <Card className="mb-2.5 flex items-center gap-2.5 p-3.5">
                      <div className="flex">
                        {crew.members.slice(0, 4).map((m, i) => (
                          <span
                            key={m.user_id}
                            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-bg font-display text-sm font-bold text-bg"
                            style={{
                              background: avatarColor(m.user_id || m.display_name),
                              marginRight:
                                i < Math.min(crew.members.length, 4) - 1 ? -10 : 0,
                            }}
                          >
                            {initials(m.display_name)}
                          </span>
                        ))}
                      </div>
                      <div className="flex-1 text-[13px] text-muted">
                        <b className="font-display text-text">
                          {crew.trainedCount} of {crew.totalCount}
                        </b>{" "}
                        crew trained today
                      </div>
                      <span className="font-display text-gold">›</span>
                    </Card>
                  </Link>
                ) : (
                  <Card className="mb-2.5 flex items-center gap-3 p-3.5">
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line bg-surface2 text-base">
                      👋
                    </div>
                    <div className="flex-1 text-[13px] text-muted">
                      No crew yet —{" "}
                      <span className="text-text">join or start one</span> to
                      train together.
                    </div>
                    <Link href="/crew" className="font-display text-gold">
                      ›
                    </Link>
                  </Card>
                )}
              </div>
            );

          default:
            return null;
        }
      })}

      {/* ── Unified goals dashboard ───────────────────────────────────────
          Every active goal (exercise · diet · bible · custom) with this
          week's WeeklyProgress at a glance, each deep-linking into its
          dedicated screen (IA = both). Empty state nudges to the Goals hub. */}
      <SectionHeader action={<Link href="/goals">All goals →</Link>}>
        This Week&apos;s Goals
      </SectionHeader>
      {goalRows.length === 0 ? (
        <Link href="/goals" className="block">
          <Card className="mb-2.5 flex items-center gap-3 p-3.5">
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line bg-surface2 text-base">
              🎯
            </div>
            <div className="flex-1 text-[13px] text-muted">
              No goals yet —{" "}
              <span className="text-text">set training, macros, reading, or a custom habit</span>.
            </div>
            <span className="font-display text-gold">›</span>
          </Card>
        </Link>
      ) : (
        <div className="mb-1 space-y-2.5">
          {goalRows.map(({ tracker, progress }) => (
            <Link key={tracker.id} href={trackerHref(tracker.type)} className="block">
              <Card className="p-3.5">
                <div className="mb-2.5 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-line bg-surface2 text-base">
                    {trackerIcon(tracker.type, tracker.icon)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[13px] font-bold uppercase tracking-[0.03em] text-text">
                      {tracker.title}
                    </div>
                    <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
                      {TYPE_LABEL[tracker.type]}
                      {progress.streak > 0 ? (
                        <span className="ml-2 text-gold">🔥 {progress.streak}</span>
                      ) : null}
                    </div>
                  </div>
                  <span className="font-display text-gold" aria-hidden>
                    ›
                  </span>
                </div>
                <WeeklyProgress data={progress} ringSize={44} />
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* ── Primary CTA ─────────────────────────────────────────────────── */}
      {hasSession ? (
        <Link
          href="/checkin"
          className="relative z-10 mt-1 flex w-full items-center justify-center gap-2 rounded-[18px] bg-grad p-[17px] font-display text-[15px] font-semibold uppercase tracking-wide text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
          {sessionDone ? "Review Today's Session" : "Start Today's Session"}
        </Link>
      ) : (
        <Link
          href="/programs"
          className="relative z-10 mt-1 flex w-full items-center justify-center gap-2 rounded-[18px] bg-grad p-[17px] font-display text-[15px] font-semibold uppercase tracking-wide text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current [stroke-width:2.4]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Browse Programs
        </Link>
      )}

      {/* ── Schedule affordance ─────────────────────────────────────────────
          Phase 4: jump to the weekday schedule editor. Shows the current
          training days (or weekly count) so the user knows today's context. */}
      {schedule ? (
        <Link
          href="/goals/training"
          className="relative z-10 mt-2 flex w-full items-center justify-between gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 text-left"
        >
          <span className="font-cond text-[11px] font-bold uppercase tracking-[1.5px] text-muted">
            {schedule.goalType === "count"
              ? `Schedule · ${schedule.weeklyTarget} / week`
              : isRestDay
                ? "Schedule · Rest day today"
                : "Schedule · Training day today"}
          </span>
          <span className="font-display text-sm font-semibold uppercase tracking-wide text-gold">
            Edit ›
          </span>
        </Link>
      ) : null}
    </>
  );
}

/* ── Local presentational helper: one ring card ─────────────────────────── */
function RingCard({
  value,
  color,
  centerLabel,
  valueCaption,
  label,
}: {
  value: number;
  color: string;
  centerLabel: ReactNode;
  valueCaption: ReactNode;
  label: string;
}) {
  return (
    <Card className="flex-1 p-3.5 text-center">
      <div className="flex justify-center">
        <Ring value={value} color={color} size={56} stroke={6} label={centerLabel} />
      </div>
      <div className="mt-1.5 font-display text-lg font-bold text-text">
        {valueCaption}
      </div>
      <div className="mt-0.5 font-cond text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
    </Card>
  );
}
