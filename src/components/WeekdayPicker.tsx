"use client";

/* ════════════════════════════════════════════════════════════════════
   WeekdayPicker — controlled 7-chip Mon→Sun weekday selector.

   Shared primitive for every later phase (Exercise scheduling, Bible
   specific-weekdays, Custom trackers). Presentational only — no data
   fetching. Values are Postgres dow (0=Sun..6=Sat), matching
   trackers.scheduled_weekdays and profiles.training_days (0009).

   Reuses the visual language of the training-goal day picker
   (src/app/(app)/goals/training/_components.tsx): active chip = bg-grad text-on-grad,
   inactive = border-line bg-surface text-muted, uppercase display type.
   ════════════════════════════════════════════════════════════════════ */

import { type ReactNode } from "react";

/** Mon-first display order; `dow` matches Postgres extract(dow) (0=Sun..6=Sat). */
const WEEKDAYS: ReadonlyArray<{ dow: number; short: string }> = [
  { dow: 1, short: "Mon" },
  { dow: 2, short: "Tue" },
  { dow: 3, short: "Wed" },
  { dow: 4, short: "Thu" },
  { dow: 5, short: "Fri" },
  { dow: 6, short: "Sat" },
  { dow: 0, short: "Sun" },
];

export interface WeekdayPickerProps {
  /** Selected weekdays as Postgres dow values (0=Sun..6=Sat). */
  value: number[];
  /** Called with the next selection (sorted, distinct) when a chip is toggled. */
  onChange: (next: number[]) => void;
  disabled?: boolean;
  /** Optional caption under the chips (e.g. "3 days / week"). */
  footer?: ReactNode;
  className?: string;
}

export function WeekdayPicker({
  value,
  onChange,
  disabled,
  footer,
  className,
}: WeekdayPickerProps) {
  const selected = new Set(value);

  const toggle = (dow: number) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(dow)) next.delete(dow);
    else next.add(dow);
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => {
          const on = selected.has(d.dow);
          return (
            <button
              key={d.dow}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(d.dow)}
              className={`min-w-[44px] flex-1 rounded-[12px] border px-2 py-3 font-display text-sm font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                on
                  ? "border-transparent bg-grad text-on-grad"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {d.short}
            </button>
          );
        })}
      </div>
      {footer != null ? (
        <p className="mt-3 font-cond text-[11px] uppercase tracking-wide text-faint">
          {footer}
        </p>
      ) : null}
    </div>
  );
}
