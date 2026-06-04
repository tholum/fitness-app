import { redirect } from "next/navigation";
import { getProfile } from "@/lib/queries";
import { saveTrainingGoal } from "@/lib/actions";
import { GoalEditor } from "./_components";
import type { GoalType } from "@/lib/types";

/* ════════════════════════════════════════════════════════════════════
   TRAINING GOALS (/goals) — 0009.
   Sets the per-user goal that drives the streak so rest days don't break it:
     • "days"  → specific weekdays (e.g. Mon/Wed/Fri). Rest days are skipped.
     • "count" → a flexible weekly target (N sessions/week, any days). Streak
                 counts consecutive weeks that hit the target.
   Server component: reads the current goal off the profile and hands it to the
   client editor, which calls the saveTrainingGoal server action.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const type: GoalType = profile.goal_type === "count" ? "count" : "days";
  const days = Array.isArray(profile.training_days)
    ? profile.training_days
    : [1, 3, 5];
  const target = profile.weekly_target ?? 3;

  return (
    <>
      {/* Header — mirrors the prototype .hd pattern used across screens. */}
      <header className="relative z-10 px-0.5 pb-[18px] pt-2">
        <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
          Train your way
        </div>
        <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-[0.03em] text-text">
          Training Goals
        </h1>
      </header>

      <GoalEditor
        initialType={type}
        initialDays={days}
        initialTarget={target}
        saveAction={saveTrainingGoal}
      />
    </>
  );
}
