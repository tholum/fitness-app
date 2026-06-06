import type { ReactNode } from "react";
import Link from "next/link";
import { Card, SectionHeader, Ring } from "@/components/ui";
import { WeeklyProgress } from "@/components/WeeklyProgress";
import {
  getBodyToday,
  getTrackers,
  getWeeklyProgress,
} from "@/lib/queries";
import { weekdayLabel } from "@/lib/format";
import type { Json, Tracker } from "@/lib/types";
import {
  DietProvider,
  AddFoodPill,
  DietLink,
  DietBlockButton,
  FoodRow,
  type MacroTargets,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   DIET / MACROS screen (/diet) — Phase 2, first-class.
   The primary macro experience: today's totals vs. targets as rings
   (calories + protein/carbs/fat), a quick "+ Add food" portaled sheet, the
   day's food entries, and weekly adherence (7-day strip + summary).

   Targets live in the singleton diet tracker's config jsonb
   (config.macros {kcal,protein,carbs,fat} = daily targets). Daily logging
   REUSES nutrition_logs via getBodyToday + the existing logMeal/updateMeal/
   deleteMeal actions — no duplicated schema. Weekly adherence comes from
   getWeeklyProgress(dietTracker), which sums nutrition_logs for the week.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── config → MacroTargets (defensive read of the untyped jsonb) ──────── */
function readTargets(config: Json | null | undefined): MacroTargets {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const macros = (cfg.macros ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
  };
  return {
    kcal: n(macros.kcal),
    protein: n(macros.protein),
    carbs: n(macros.carbs),
    fat: n(macros.fat),
  };
}

function pct(value: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

/* ── Calorie ring (large, centered) ───────────────────────────────────── */
function CalorieRing({ kcal, goal }: { kcal: number; goal: number }) {
  const size = 150;
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct(kcal, goal));
  const center = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block"
      role="img"
      aria-label={`${kcal} of ${goal || "—"} kilocalories`}
    >
      <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="url(#dietGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <defs>
        <linearGradient id="dietGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <text x={center} y={center - 6} textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="34" fill="var(--text)">
        {kcal}
      </text>
      <text x={center} y={center + 16} textAnchor="middle" fontFamily="var(--font-cond)" fontSize="11" letterSpacing="1" fill="var(--muted)">
        {goal > 0 ? `/ ${goal} KCAL` : "KCAL"}
      </text>
    </svg>
  );
}

/* ── A macro ring (protein / carbs / fat) ─────────────────────────────── */
function MacroRing({
  value,
  goal,
  label,
  color,
}: {
  value: number;
  goal: number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <Ring value={pct(value, goal)} size={64} stroke={7} color={color} label={`${value}g`} />
      <div className="text-center">
        <div className="font-cond text-[10px] uppercase tracking-wide text-muted">{label}</div>
        <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
          {goal > 0 ? `/ ${goal}g` : "no goal"}
        </div>
      </div>
    </div>
  );
}

/* ── Food list row ────────────────────────────────────────────────────── */
function FoodItem({
  title,
  sub,
  value,
}: {
  title: string;
  sub: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card className="mb-2.5 flex items-center gap-[13px] p-3.5">
      <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border border-line bg-surface2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.9]">
        <svg viewBox="0 0 24 24">
          <path d="M5 3v18M5 8h6M19 3c-2 4-2 7 0 10v8" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
          {title}
        </div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="font-display text-base font-bold text-text">{value}</div>
    </Card>
  );
}

/** Compact "P/C/F" macro sub-label for a food row. */
function macroSub(protein: number | null, carbs: number | null, fat: number | null): string {
  const parts: string[] = [];
  if (protein != null) parts.push(`${protein}P`);
  if (carbs != null) parts.push(`${carbs}C`);
  if (fat != null) parts.push(`${fat}F`);
  return parts.length ? parts.join(" · ") : "Logged";
}

export default async function DietPage() {
  const body = await getBodyToday();
  const trackers = await getTrackers();
  const dietTracker: Tracker | null = trackers.find((t) => t.type === "diet") ?? null;

  const targets = readTargets(dietTracker?.config);
  const { meals, kcal, protein, carbs, fat } = body;

  // Weekly adherence is computed from nutrition_logs by the foundation helper.
  const weekly = dietTracker
    ? await getWeeklyProgress(dietTracker)
    : null;

  const dateLabel = `${weekdayLabel(new Date(), true)}, ${new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  })}`;

  const hasGoals =
    targets.kcal > 0 || targets.protein > 0 || targets.carbs > 0 || targets.fat > 0;

  return (
    <DietProvider tracker={dietTracker} targets={targets}>
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">{dateLabel}</div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Nutrition
          </h1>
        </div>
        <AddFoodPill />
      </div>

      {/* Today's totals vs targets — calorie ring + macro rings */}
      <Card className="mb-3.5 p-5 text-center">
        <CalorieRing kcal={kcal} goal={targets.kcal} />
        <div className="mt-3 flex gap-2.5">
          <MacroRing value={protein} goal={targets.protein} label="Protein" color="var(--accent)" />
          <MacroRing value={carbs} goal={targets.carbs} label="Carbs" color="var(--gold)" />
          <MacroRing value={fat} goal={targets.fat} label="Fat" color="var(--accent2)" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-3">
          {kcal === 0 ? (
            <p className="font-cond text-[11px] uppercase tracking-wide text-faint">
              No food logged yet today
            </p>
          ) : null}
          <DietLink kind="macros">{hasGoals ? "Edit Macro Goals" : "Set Macro Goals"}</DietLink>
        </div>
      </Card>

      {/* No goals set → prompt to set them */}
      {!hasGoals ? (
        <Card className="mb-3.5 p-5 text-center">
          <p className="mb-3 text-[13px] text-muted">
            Set your daily macro goals to light up the rings and track weekly adherence.
          </p>
          <DietBlockButton kind="macros">Set Macro Goals</DietBlockButton>
        </Card>
      ) : null}

      {/* Weekly adherence (from getWeeklyProgress over nutrition_logs) */}
      {weekly ? (
        <>
          <SectionHeader>This Week</SectionHeader>
          <Card className="mb-3.5 p-4">
            <WeeklyProgress data={weekly} />
            <p className="mt-3 font-cond text-[11px] uppercase tracking-wide text-faint">
              {weekly.target > 0
                ? `${Math.round(weekly.done)} / ${Math.round(weekly.target)} ${weekly.unit ?? ""} this week`
                : "Weekly calorie total"}
            </p>
          </Card>
        </>
      ) : null}

      {/* Today's food entries */}
      <SectionHeader action={<DietLink kind="food">+ Add</DietLink>}>Today&apos;s Food</SectionHeader>
      {meals.length ? (
        meals.map((m) => (
          <FoodRow key={m.id} meal={m}>
            <FoodItem
              title={m.meal?.trim() || "Food"}
              sub={macroSub(m.protein, m.carbs, m.fat)}
              value={m.kcal ?? "—"}
            />
          </FoodRow>
        ))
      ) : (
        <Card className="mb-2.5 p-5 text-center">
          <p className="mb-3 text-[13px] text-muted">
            Nothing logged yet. Add food to fill your rings.
          </p>
          <DietBlockButton kind="food">Add Food</DietBlockButton>
        </Card>
      )}

      {/* Coherence: link back to the Body screen (water + metrics live there). */}
      <Link
        href="/body"
        className="mt-2 flex items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        Water &amp; body metrics on Body
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </DietProvider>
  );
}
