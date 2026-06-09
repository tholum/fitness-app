"use client";

/* ════════════════════════════════════════════════════════════════════
   TRAINING SCHEDULE — client editor (0009 + Phase 4 / 0011).
   A mode toggle (Specific days / Weekly count) plus the matching control:
     • days  → the shared WeekdayPicker (Mon-first; Postgres dow 0=Sun..6=Sat)
     • count → a 1–7 sessions/week stepper
   Saving calls the saveTrainingGoal server action, which persists via the
   SECURITY DEFINER setter, re-derives the streak, AND syncs the singleton
   exercise tracker (0011) so the dashboard reflects the chosen weekdays.

   Below the editor we show a READ-ONLY weekly-progress preview (this week's
   completed sessions vs. the schedule) using the shared WeeklyProgress
   component — the same visual the unified dashboard renders.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader, Segmented } from "@/components/ui";
import { WeekdayPicker } from "@/components/WeekdayPicker";
import { WeeklyProgress, type WeeklyProgressData } from "@/components/WeeklyProgress";
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

const MODE_OPTIONS = [
  { value: "days", label: "Specific days" },
  { value: "count", label: "Weekly count" },
] as const satisfies ReadonlyArray<{ value: GoalType; label: string }>;

export function GoalEditor({
  initialType,
  initialDays,
  initialTarget,
  saveAction,
  weeklyProgress,
  programName,
  streak,
}: {
  initialType: GoalType;
  initialDays: number[];
  initialTarget: number;
  saveAction: SaveGoalFn;
  /** This-week exercise progress (from session_logs) for the preview. */
  weeklyProgress: WeeklyProgressData | null;
  /** Active program name, shown in the preview header. */
  programName: string | null;
  /** Current session streak (days for 'days' mode, weeks for 'count'). */
  streak: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<GoalType>(initialType);
  const [days, setDays] = useState<number[]>(initialDays);
  const [target, setTarget] = useState<number>(
    Math.min(7, Math.max(1, initialTarget)),
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const bumpTarget = (delta: number) => {
    setMsg(null);
    setTarget((t) => Math.min(7, Math.max(1, t + delta)));
  };

  const daysInvalid = mode === "days" && days.length === 0;
  const streakUnit = mode === "count" ? "week" : "day";

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
      setMsg({ ok: true, text: "Saved — schedule, streak & dashboard updated." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Mode */}
      <Card className="p-5">
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

      {/* Specific days — shared WeekdayPicker */}
      {mode === "days" ? (
        <Card className="p-5">
          <SectionHeader>Training days</SectionHeader>
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Tap the days you train. A scheduled day you miss breaks the streak;
            the days you leave off are rest days and never do.
          </p>
          <WeekdayPicker
            value={days}
            onChange={(next) => {
              setMsg(null);
              setDays(next);
            }}
            footer={`${days.length} day${days.length === 1 ? "" : "s"} / week`}
          />
        </Card>
      ) : (
        /* Weekly count */
        <Card className="p-5">
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
          className="w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-on-grad shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save schedule"}
        </button>
      </div>

      {/* This week — read-only exercise progress (the dashboard's own visual) */}
      {weeklyProgress ? (
        <Card className="p-5">
          <SectionHeader
            action={
              <span className="font-cond text-[11px] uppercase tracking-wide text-gold">
                🔥 {streak} {streakUnit}
                {streak === 1 ? "" : "s"}
              </span>
            }
          >
            This week{programName ? ` · ${programName}` : ""}
          </SectionHeader>
          <WeeklyProgress data={weeklyProgress} />
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Completed sessions this week vs. your schedule. Dots show each day —
            filled for a trained day, hollow-accent for a scheduled day not yet
            done.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
