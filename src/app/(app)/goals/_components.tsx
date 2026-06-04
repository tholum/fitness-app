"use client";

/* ════════════════════════════════════════════════════════════════════
   TRAINING GOALS — client editor (0009).
   A mode toggle (Specific days / Weekly count) plus the matching control:
     • days  → 7 weekday chips (Mon-first; values are Postgres dow 0=Sun..6=Sat)
     • count → a 1–7 sessions/week stepper
   Saving calls the saveTrainingGoal server action, which persists via the
   SECURITY DEFINER setter and re-derives the streak.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader, Segmented } from "@/components/ui";
import type { GoalType } from "@/lib/types";

export interface SaveResult {
  ok: boolean;
  error?: string;
}
export type SaveGoalFn = (input: {
  type: "days" | "count";
  days: number[];
  target: number;
}) => Promise<SaveResult>;

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

const MODE_OPTIONS = [
  { value: "days", label: "Specific days" },
  { value: "count", label: "Weekly count" },
] as const satisfies ReadonlyArray<{ value: GoalType; label: string }>;

export function GoalEditor({
  initialType,
  initialDays,
  initialTarget,
  saveAction,
}: {
  initialType: GoalType;
  initialDays: number[];
  initialTarget: number;
  saveAction: SaveGoalFn;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<GoalType>(initialType);
  const [days, setDays] = useState<number[]>(initialDays);
  const [target, setTarget] = useState<number>(
    Math.min(7, Math.max(1, initialTarget)),
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggleDay = (dow: number) => {
    setMsg(null);
    setDays((d) =>
      d.includes(dow) ? d.filter((x) => x !== dow) : [...d, dow],
    );
  };

  const bumpTarget = (delta: number) => {
    setMsg(null);
    setTarget((t) => Math.min(7, Math.max(1, t + delta)));
  };

  const daysInvalid = mode === "days" && days.length === 0;

  function save() {
    if (daysInvalid) {
      setMsg({ ok: false, text: "Pick at least one training day." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await saveAction({ type: mode, days, target });
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Could not save." });
        return;
      }
      setMsg({ ok: true, text: "Saved — your streak was updated." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Mode */}
      <Card>
        <SectionHeader>Goal type</SectionHeader>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          Choose how your streak is measured so rest days never count against
          you.
        </p>
        <Segmented<GoalType>
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setMsg(null);
          }}
        />
      </Card>

      {/* Specific days */}
      {mode === "days" ? (
        <Card>
          <SectionHeader>Training days</SectionHeader>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Tap the days you train. A scheduled day you miss breaks the streak;
            the days you leave off are rest days and never do.
          </p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const on = days.includes(d.dow);
              return (
                <button
                  key={d.dow}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d.dow)}
                  className={`min-w-[44px] flex-1 rounded-[12px] border px-2 py-3 font-display text-sm font-semibold uppercase tracking-wide transition-colors ${
                    on
                      ? "border-transparent bg-grad text-bg"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-cond text-[11px] uppercase tracking-wide text-faint">
            {days.length} day{days.length === 1 ? "" : "s"} / week
          </p>
        </Card>
      ) : (
        /* Weekly count */
        <Card>
          <SectionHeader>Weekly target</SectionHeader>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            Train any days you like — just hit this many sessions each week. Your
            streak counts consecutive weeks you reach the target.
          </p>
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              aria-label="Fewer sessions"
              onClick={() => bumpTarget(-1)}
              disabled={target <= 1}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl text-text disabled:opacity-40"
            >
              −
            </button>
            <div className="text-center">
              <div className="font-display text-[44px] font-bold leading-none text-text">
                {target}
              </div>
              <div className="mt-1 font-cond text-[11px] uppercase tracking-wide text-faint">
                sessions / week
              </div>
            </div>
            <button
              type="button"
              aria-label="More sessions"
              onClick={() => bumpTarget(1)}
              disabled={target >= 7}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl text-text disabled:opacity-40"
            >
              +
            </button>
          </div>
        </Card>
      )}

      {/* Save + feedback */}
      <div className="space-y-2">
        {msg ? (
          <p
            aria-live="polite"
            className={`font-cond text-xs font-semibold uppercase tracking-wide ${
              msg.ok ? "text-gold" : "text-danger"
            }`}
          >
            {msg.text}
          </p>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={pending || daysInvalid}
          className="w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save goal"}
        </button>
      </div>
    </div>
  );
}
