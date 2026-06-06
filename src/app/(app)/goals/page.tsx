import { redirect } from "next/navigation";
import {
  getProfile,
  getActiveEnrollment,
  getWeeklyProgress,
} from "@/lib/queries";
import { saveTrainingGoal, syncExerciseTracker } from "@/lib/actions";
import { GoalEditor } from "./_components";
import type { GoalType, Tracker } from "@/lib/types";
import type { WeeklyProgressData } from "@/components/WeeklyProgress";
import { createClient } from "@/lib/supabase/server";

/* ════════════════════════════════════════════════════════════════════
   TRAINING GOALS / EXERCISE SCHEDULE (/goals) — 0009 + Phase 4 (0011).

   Sets the per-user training goal that drives the streak so rest days don't
   break it, AND — the Phase 4 addition — lets the user choose WHICH weekdays
   their training sessions land on:
     • "days"  → specific weekdays (e.g. Mon/Wed/Fri). Rest days are skipped;
                 a scheduled day you miss breaks the streak.
     • "count" → a flexible weekly target (N sessions/week, any days). Streak
                 counts consecutive weeks that hit the target.

   The schedule is stored ONCE on the profile (training_days / goal_type /
   weekly_target — the canonical source that recompute_my_stats() reads). The
   set_my_training_goal() RPC mirrors it into the singleton `exercise` tracker
   (0011) so the unified dashboard shows exercise weekly progress.

   Server component: backfills/syncs the exercise tracker on load (idempotent),
   reads the current goal + this-week exercise progress, and hands them to the
   client editor (which calls the saveTrainingGoal server action).
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Backfill: ensure the singleton exercise tracker exists and matches the
  // current schedule (no-op for users created after Phase 4). Idempotent.
  await syncExerciseTracker();

  const type: GoalType = profile.goal_type === "count" ? "count" : "days";
  const days = Array.isArray(profile.training_days)
    ? profile.training_days
    : [1, 3, 5];
  const target = profile.weekly_target ?? 3;

  // This-week exercise progress (from session_logs) + active program name, for
  // the read-only preview under the editor.
  const supabase = await createClient();
  const { data: exerciseRow } = await supabase
    .from("trackers")
    .select("*")
    .eq("user_id", profile.id)
    .eq("type", "exercise")
    .eq("archived", false)
    .maybeSingle();

  const [progress, enrollment] = await Promise.all([
    exerciseRow
      ? getWeeklyProgress(exerciseRow as Tracker, profile.id)
      : Promise.resolve(null),
    getActiveEnrollment(profile.id),
  ]);

  const progressData: WeeklyProgressData | null = progress
    ? {
        done: progress.done,
        target: progress.target,
        unit: progress.unit,
        perDay: progress.perDay,
        streak: progress.streak,
        scheduledWeekdays: progress.scheduledWeekdays,
      }
    : null;

  return (
    <>
      {/* Header — mirrors the prototype .hd pattern used across screens. */}
      <header className="relative z-10 px-0.5 pb-[18px] pt-2">
        <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
          Train your way
        </div>
        <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-[0.03em] text-text">
          Training Schedule
        </h1>
      </header>

      <GoalEditor
        initialType={type}
        initialDays={days}
        initialTarget={target}
        saveAction={saveTrainingGoal}
        weeklyProgress={progressData}
        programName={enrollment?.program?.name ?? null}
        streak={profile.streak_count ?? 0}
      />
    </>
  );
}
