"use client";

/* ════════════════════════════════════════════════════════════════════
   WeeklyProgress — compact weekly progress visual.

   Shared primitive for every later phase (Dashboard, per-type screens).
   Presentational only — driven entirely by the WeeklyProgress shape from
   queries.ts (no data fetching here). Two layouts:

     • a progress Ring (done / target) using the app's <Ring> primitive, and
     • a 7-dot Mon→Sun week strip showing per-day completion / amount.

   Matches the app's design tokens (bg-grad / gold / accent, display+cond
   fonts). The `perDay` and `scheduledWeekdays` arrays are Monday-first
   (index 0 = Mon, 6 = Sun) to line up with the strip below.
   ════════════════════════════════════════════════════════════════════ */

import { type ReactNode } from "react";
import { Ring } from "@/components/ui";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Mirrors the WeeklyProgress shape returned by queries.getWeeklyProgress.
 * Re-declared (not imported) so this component carries no server dependency.
 */
export interface WeeklyProgressData {
  done: number;
  target: number;
  unit: string | null;
  /** 7 entries, Monday-first (index 0 = Mon). boolean = did-it, number = amount. */
  perDay: Array<boolean | number>;
  streak: number;
  /** Mon-first committed weekdays (specific_weekdays); null otherwise. */
  scheduledWeekdays?: boolean[] | null;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function fmt(n: number): string {
  // Trim trailing .0 for whole numbers; keep one decimal otherwise.
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}

export interface WeeklyProgressProps {
  data: WeeklyProgressData;
  /** Show the done/target count beside/over the ring. Default true. */
  showCount?: boolean;
  /** Show the 7-dot Mon→Sun strip. Default true. */
  showStrip?: boolean;
  /** Ring diameter (px). Default 56. */
  ringSize?: number;
  /** Optional trailing content (e.g. a streak chip). */
  trailing?: ReactNode;
  className?: string;
}

export function WeeklyProgress({
  data,
  showCount = true,
  showStrip = true,
  ringSize = 56,
  trailing,
  className,
}: WeeklyProgressProps) {
  const { done, target, unit, perDay, scheduledWeekdays } = data;
  const ratio = target > 0 ? Math.min(1, done / target) : done > 0 ? 1 : 0;
  const pct = Math.round(ratio * 100);
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <div className={cx("flex items-center gap-4", className)}>
      <Ring value={ratio} size={ringSize} label={`${pct}%`} />

      <div className="min-w-0 flex-1">
        {showCount ? (
          <div className="font-display text-[15px] font-bold text-text">
            {fmt(done)}
            {target > 0 ? (
              <span className="text-muted"> / {fmt(target)}</span>
            ) : null}
            {unitSuffix ? (
              <span className="font-cond text-xs font-semibold uppercase tracking-wide text-faint">
                {unitSuffix}
              </span>
            ) : null}
          </div>
        ) : null}

        {showStrip ? (
          <div className="mt-2 flex gap-1.5">
            {perDay.map((d, i) => {
              const filled = typeof d === "number" ? d > 0 : d;
              const scheduled = scheduledWeekdays?.[i] ?? null;
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden
                    className={cx(
                      "h-2.5 w-2.5 rounded-full transition-colors",
                      filled
                        ? "bg-grad"
                        : scheduled
                          ? "bg-accent2/40"
                          : "bg-line-solid",
                    )}
                  />
                  <span className="font-cond text-[9px] uppercase leading-none text-faint">
                    {DAY_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {trailing != null ? <div className="flex-shrink-0">{trailing}</div> : null}
    </div>
  );
}
