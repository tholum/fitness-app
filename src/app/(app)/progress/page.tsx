import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgress, type Progress } from "@/lib/queries";
import { startOfWeek, toISODate } from "@/lib/format";
import type { Badge, SessionLog, UserBadge } from "@/lib/types";
import { Card, SectionHeader } from "@/components/ui";
import {
  ProgressRecords,
  type PRRow,
  type SessionRow,
} from "../account/_components";

/* ════════════════════════════════════════════════════════════════════
   PROGRESS
   Ported from design-prototypes/variant-4-basecamp (#s-progress).
   Server component. Sources live data via getProgress() and a small
   local badge-catalog query (the shared queries only return *earned*
   badges; the shelf also needs the locked ones). Renders graceful
   empty states for fresh / unseeded accounts.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const WEEKS_BACK = 7;

/**
 * XP convention (the DB stores a flat `xp int` + separate `level int`):
 * `xp` is treated as progress *within* the current level, and the XP
 * required to reach the next level scales with level. This makes the
 * fresh state (level 1 / xp 0) render cleanly and matches the prototype's
 * "2,340 / 3,000 XP to Level 13" feel at higher levels.
 */
const XP_PER_LEVEL = 250;
function xpForNextLevel(level: number): number {
  return Math.max(1, level) * XP_PER_LEVEL;
}

/** Earthy rank title derived from level — flavor for the level badge. */
function rankTitle(level: number): string {
  if (level >= 20) return "Summit Seeker";
  if (level >= 12) return "Backcountry Athlete";
  if (level >= 6) return "Trail Hardened";
  if (level >= 2) return "Trailhead Recruit";
  return "Base Camper";
}

interface WeekBar {
  label: string;
  count: number;
}

/**
 * Bucket completed sessions into the last WEEKS_BACK calendar weeks
 * (Monday-start), oldest → newest, labelled W1…W7.
 */
function weeklySessionBars(sessions: SessionLog[]): WeekBar[] {
  const thisWeekStart = startOfWeek(new Date());
  // Build the ordered list of week-start ISO keys, oldest first.
  const starts: string[] = [];
  for (let i = WEEKS_BACK - 1; i >= 0; i--) {
    const d = new Date(thisWeekStart);
    d.setDate(thisWeekStart.getDate() - i * 7);
    starts.push(toISODate(d));
  }
  const counts = new Map<string, number>(starts.map((s) => [s, 0]));

  for (const s of sessions) {
    if (!s.date) continue;
    const key = toISODate(startOfWeek(s.date));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return starts.map((s, i) => ({ label: `W${i + 1}`, count: counts.get(s) ?? 0 }));
}

/** Fetch the full badge catalog (world-readable) for the locked/earned shelf. */
async function getBadgeCatalog(): Promise<Badge[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("badges")
    .select("key, name, emoji, description")
    .order("key", { ascending: true });
  if (error || !data) return [];
  return data as Badge[];
}

// ── Level / XP card ─────────────────────────────────────────────────────
function LevelCard({ progress }: { progress: Progress }) {
  const level = progress.level;
  const goal = xpForNextLevel(level);
  const xp = Math.max(0, Math.min(progress.xp, goal));
  const pct = goal > 0 ? Math.round((xp / goal) * 100) : 0;

  return (
    <Card className="mb-3.5 p-5 text-center">
      <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-grad font-display text-3xl font-bold text-on-grad shadow-[0_0_30px_rgba(200,98,45,.4)]">
        {level}
      </div>
      <div className="font-display text-lg font-semibold uppercase tracking-[0.03em] text-text">
        {rankTitle(level)}
      </div>
      <div className="mb-3.5 mt-1 text-xs text-muted">
        {xp.toLocaleString()} / {goal.toLocaleString()} XP to Level {level + 1}
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-md bg-black/30"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i className="block h-full rounded-md bg-grad" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

// ── Weekly "Sessions Completed" bar chart ───────────────────────────────
function SessionsChart({ bars }: { bars: WeekBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const hasAny = bars.some((b) => b.count > 0);

  return (
    <Card>
      {hasAny ? (
        <div className="relative flex h-[120px] items-end gap-2 px-4 pb-7 pt-4">
          {bars.map((b) => {
            // Scale to the busiest week; keep a sliver visible for zero weeks.
            const h = b.count > 0 ? Math.max(10, (b.count / max) * 100) : 4;
            return (
              <div
                key={b.label}
                className="relative min-h-[4px] flex-1 rounded-t-md bg-grad"
                style={{ height: `${h}%`, opacity: b.count > 0 ? 1 : 0.25 }}
                title={`${b.label}: ${b.count} session${b.count === 1 ? "" : "s"}`}
              >
                <span className="absolute -bottom-5 left-0 right-0 text-center font-cond text-[9px] uppercase text-faint">
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-[120px] flex-col items-center justify-center px-5 text-center">
          <div className="font-display text-sm font-semibold uppercase tracking-wide text-text">
            No sessions yet
          </div>
          <div className="mt-1 text-xs text-muted">
            Complete a check-in and your weekly progress builds here.
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Badge shelf (earned + locked) ───────────────────────────────────────
function BadgeShelf({
  earned,
  catalog,
}: {
  earned: Array<UserBadge & { badge: Badge | null }>;
  catalog: Badge[];
}) {
  const earnedKeys = new Set(earned.map((b) => b.badge_key));

  // Prefer the full catalog so locked badges show; fall back to just-earned
  // when the catalog table is empty/unseeded.
  let display: Array<{ badge: Badge; earned: boolean }> = [];
  if (catalog.length) {
    display = catalog.map((b) => ({ badge: b, earned: earnedKeys.has(b.key) }));
  } else if (earned.length) {
    display = earned
      .filter((b): b is UserBadge & { badge: Badge } => b.badge != null)
      .map((b) => ({ badge: b.badge, earned: true }));
  }

  if (!display.length) {
    return (
      <Card className="px-5 py-8 text-center">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-text">
          No badges yet
        </div>
        <div className="mt-1 text-xs text-muted">
          Train, hit PRs, and rally your crew to start earning badges.
        </div>
      </Card>
    );
  }

  // Earned first, then locked — most rewarding view.
  display.sort((a, b) => Number(b.earned) - Number(a.earned));

  return (
    <div className="no-scrollbar -mx-[18px] flex gap-3 overflow-x-auto px-[18px] py-1">
      {display.map(({ badge, earned: isEarned }) => (
        <div key={badge.key} className="w-[84px] flex-shrink-0 text-center">
          <div
            className={
              isEarned
                ? "mx-auto mb-1.5 flex h-[66px] w-[66px] items-center justify-center rounded-full bg-grad2 text-[28px]"
                : "mx-auto mb-1.5 flex h-[66px] w-[66px] items-center justify-center rounded-full border border-dashed border-line-solid bg-surface2 text-[28px] opacity-40 grayscale"
            }
          >
            {isEarned ? (badge.emoji ?? "🏅") : "🔒"}
          </div>
          <div className="font-cond text-[10px] font-semibold uppercase tracking-[0.03em] text-muted">
            {badge.name}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ProgressPage() {
  const [progress, catalog] = await Promise.all([getProgress(), getBadgeCatalog()]);
  const bars = weeklySessionBars(progress.recentSessions);

  const earnedCount = progress.badges.length;
  const totalBadges = catalog.length || earnedCount;

  // Map the already-fetched rows into the client island's local shapes.
  const prRows: PRRow[] = progress.prs.map((p) => ({
    id: p.id,
    label: p.label,
    value: p.value,
    unit: p.unit,
    achieved_on: p.achieved_on,
  }));
  const sessionRows: SessionRow[] = progress.recentSessions.slice(0, 8).map((s) => ({
    id: s.id,
    title: s.title,
    date: s.date,
    rpe: s.rpe,
    duration_min: s.duration_min,
    notes: s.notes,
  }));

  return (
    <>
      {/* Header — matches prototype .hd for the Progress screen. */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[2px] text-muted">
            Your journey
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[1px] text-text">
            Progress
          </h1>
        </div>
      </div>

      {/* Level / XP — gamification (hidden when that toggle is off). */}
      <div className="gamify-feature">
        <LevelCard progress={progress} />
      </div>

      {/* Door into the Goals hub — goals are configured there, measured here.
          This is the only nav path to /goals (the bottom bar tab is Progress). */}
      <Link href="/goals" className="mb-3.5 block">
        <Card className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface2 text-lg">
            🎯
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[14px] font-bold uppercase tracking-[0.03em] text-text">
              Goals
            </div>
            <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
              Set targets &amp; manage what you track
            </div>
          </div>
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4] text-gold"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Card>
      </Link>

      <SectionHeader action={<span className="text-accent2">▲ this phase</span>}>
        Sessions Completed
      </SectionHeader>
      <SessionsChart bars={bars} />

      {/* Badges — gamification (hidden when that toggle is off). */}
      <div className="gamify-feature">
        <SectionHeader action={`${earnedCount} / ${totalBadges}`}>Badges</SectionHeader>
        <BadgeShelf earned={progress.badges} catalog={catalog} />
      </div>

      {/* Personal Records (+ optional recent-session history). Interactive
          client island — add/edit/delete PRs and edit/uncomplete/delete
          sessions. Lives in account/_components.tsx per the file allowlist. */}
      <ProgressRecords prs={prRows} sessions={sessionRows} />
    </>
  );
}
