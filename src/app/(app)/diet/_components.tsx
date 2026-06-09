"use client";

/* ════════════════════════════════════════════════════════════════════
   DIET / MACROS — client log + goal affordances (Phase 2).
   A single provider owns all portaled bottom-sheets for the dedicated
   /diet screen:
     • "macros"  → set/edit the macro TARGETS that live in the diet
                   tracker's config jsonb ({ macros:{kcal,protein,carbs,fat},
                   targetKey, dailyTarget, weeklyTarget }) via createTracker /
                   updateTracker. This is the singleton diet tracker.
     • "food"    → quick add / edit a food entry. REUSES the existing
                   nutrition_logs schema through logMeal / updateMeal /
                   deleteMeal (the same writes the Body screen uses) — no
                   new logging schema.
   Styling is strictly theme-token Tailwind so it re-skins with the active
   theme/accent, matching the Path Warden look. Sheets are wrapped in
   <Portal> and use fixed inset-0 z-50 (the app's sheet pattern).
   ════════════════════════════════════════════════════════════════════ */

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  logMeal,
  updateMeal,
  deleteMeal,
  createTracker,
  updateTracker,
} from "@/lib/actions";
import { Sheet } from "@/components/Sheet";
import { SubmitBtn, ErrorNote } from "@/components/ui";
import { cx } from "@/lib/cx";
import type { Json, NutritionLog, Tracker } from "@/lib/types";

/* ── Macro target contract (lives in tracker.config) ─────────────────────
   The foundation's diet config (doc §5 + getWeeklyProgress) keys off
   config.macros {kcal,protein,carbs,fat} as the DAILY targets, plus a
   targetKey/weeklyTarget that drive the weekly adherence ring. We keep all
   of those in sync from this one sheet so both the rings here and
   getWeeklyProgress agree. */
export interface MacroTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/* ── small local helpers ─────────────────────────────────────────────── */

/** Parse a form input into a number, returning null for blank/invalid. */
function num(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ── Field primitives ────────────────────────────────────────────────── */

function Field({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="relative">
        {children}
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-cond text-xs font-semibold uppercase tracking-wide text-faint">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

const inputCls =
  "w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent";

/* ════════════════════════════════════════════════════════════════════
   Context + Provider
   Placed once at the /diet page root. Owns the open sheet, an optional
   editing payload (a food row to edit), the pending/error state, and
   renders both forms. Trigger components (rendered inline by the server
   page within this subtree) call open(...) via context.
   ════════════════════════════════════════════════════════════════════ */

type SheetKind = "food" | "macros";

interface OpenOpts {
  /** Food row to edit (food sheet → update branch + delete affordance). */
  meal?: NutritionLog;
}

interface DietCtx {
  open: (kind: SheetKind, opts?: OpenOpts) => void;
}

const DietContext = createContext<DietCtx | null>(null);

function useDiet(): DietCtx {
  const ctx = useContext(DietContext);
  if (!ctx) throw new Error("Diet triggers must be inside <DietProvider>");
  return ctx;
}

export interface DietProviderProps {
  /** Existing singleton diet tracker, or null if not yet created. */
  tracker: Tracker | null;
  /** Current macro targets (from tracker.config.macros), zeroed if unset. */
  targets: MacroTargets;
  children: ReactNode;
}

export function DietProvider({ tracker, targets, children }: DietProviderProps) {
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [editingMeal, setEditingMeal] = useState<NutritionLog | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = (kind: SheetKind, opts?: OpenOpts) => {
    setError(null);
    setEditingMeal(kind === "food" ? opts?.meal ?? null : null);
    setSheet(kind);
  };
  const close = () => {
    setSheet(null);
    setEditingMeal(null);
    setError(null);
  };

  /* ── Food entry (reuses nutrition_logs via logMeal/updateMeal/deleteMeal) ── */
  function onFoodSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const meal = String(fd.get("meal") ?? "").trim();
    const input = {
      meal: meal || null,
      kcal: num(fd.get("kcal")),
      protein: num(fd.get("protein")),
      carbs: num(fd.get("carbs")),
      fat: num(fd.get("fat")),
    };
    if (
      input.kcal == null &&
      input.protein == null &&
      input.carbs == null &&
      input.fat == null
    ) {
      setError("Enter calories or a macro.");
      return;
    }
    const id = editingMeal?.id;
    startTransition(async () => {
      const res = id ? await updateMeal(id, input) : await logMeal(input);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onFoodDelete() {
    const id = editingMeal?.id;
    if (!id) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMeal(id);
      if (!res.ok) {
        setError(res.error ?? "Could not delete.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /* ── Macro targets (tracker.config) ─────────────────────────────────── */
  function onMacrosSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const macros: MacroTargets = {
      kcal: Math.max(0, Math.round(num(fd.get("kcal")) ?? 0)),
      protein: Math.max(0, Math.round(num(fd.get("protein")) ?? 0)),
      carbs: Math.max(0, Math.round(num(fd.get("carbs")) ?? 0)),
      fat: Math.max(0, Math.round(num(fd.get("fat")) ?? 0)),
    };
    if (
      macros.kcal === 0 &&
      macros.protein === 0 &&
      macros.carbs === 0 &&
      macros.fat === 0
    ) {
      setError("Set at least one target.");
      return;
    }
    // Drive the weekly adherence ring off calories by default: keep the
    // foundation's config contract (macros + targetKey/dailyTarget/weeklyTarget)
    // coherent so getWeeklyProgress agrees with the on-screen rings.
    const config: Json = {
      macros: {
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
      },
      targetKey: "kcal",
      dailyTarget: macros.kcal,
      weeklyTarget: macros.kcal * 7,
    };
    startTransition(async () => {
      const res = tracker
        ? await updateTracker(tracker.id, {
            config,
            cadenceType: "amount_per_week",
            unit: "kcal",
            weeklyTargetAmount: macros.kcal * 7,
          })
        : await createTracker({
            type: "diet",
            title: "Nutrition",
            cadenceType: "amount_per_week",
            unit: "kcal",
            weeklyTargetAmount: macros.kcal * 7,
            config,
          });
      if (!res.ok) {
        setError(res.error ?? "Could not save targets.");
        return;
      }
      close();
      router.refresh();
    });
  }

  const editing = editingMeal != null;

  return (
    <DietContext.Provider value={{ open }}>
      {children}

      {/* ── Food sheet (add OR edit) — reuses nutrition_logs ── */}
      <Sheet open={sheet === "food"} title={editing ? "Edit Food" : "Add Food"} onClose={close}>
        <form key={editingMeal?.id ?? "new"} onSubmit={onFoodSubmit} className="space-y-4">
          <Field label="Food / Meal">
            <input
              name="meal"
              type="text"
              defaultValue={editingMeal?.meal ?? ""}
              placeholder="e.g. Chicken &amp; rice"
              className={inputCls}
            />
          </Field>
          <Field label="Calories" suffix="kcal">
            <input
              name="kcal"
              type="number"
              inputMode="numeric"
              step="1"
              defaultValue={editingMeal?.kcal ?? ""}
              placeholder="0"
              className={inputCls}
            />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Protein" suffix="g">
                <input
                  name="protein"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={editingMeal?.protein ?? ""}
                  placeholder="0"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Carbs" suffix="g">
                <input
                  name="carbs"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={editingMeal?.carbs ?? ""}
                  placeholder="0"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Fat" suffix="g">
                <input
                  name="fat"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={editingMeal?.fat ?? ""}
                  placeholder="0"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>{editing ? "Save Food" : "Add Food"}</SubmitBtn>
          {editing ? (
            <button
              type="button"
              onClick={onFoodDelete}
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.06em] text-danger disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2]">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
              </svg>
              Delete Food
            </button>
          ) : null}
        </form>
      </Sheet>

      {/* ── Macro targets sheet (tracker.config) ── */}
      <Sheet
        open={sheet === "macros"}
        title={tracker ? "Edit Macro Goals" : "Set Macro Goals"}
        onClose={close}
      >
        <form onSubmit={onMacrosSubmit} className="space-y-4">
          <p className="font-cond text-[11px] uppercase tracking-wide text-faint">
            Daily targets. Calories drive your weekly adherence ring.
          </p>
          <Field label="Daily Calories" suffix="kcal">
            <input
              name="kcal"
              type="number"
              inputMode="numeric"
              step="1"
              defaultValue={targets.kcal || ""}
              placeholder="2400"
              className={inputCls}
            />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Protein" suffix="g">
                <input
                  name="protein"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={targets.protein || ""}
                  placeholder="150"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Carbs" suffix="g">
                <input
                  name="carbs"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={targets.carbs || ""}
                  placeholder="250"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Fat" suffix="g">
                <input
                  name="fat"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  defaultValue={targets.fat || ""}
                  placeholder="70"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>{tracker ? "Save Goals" : "Set Goals"}</SubmitBtn>
        </form>
      </Sheet>
    </DietContext.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Trigger components (rendered inline by the server page).
   ════════════════════════════════════════════════════════════════════ */

/** Header pill → opens the food sheet (quick add). */
export function AddFoodPill() {
  const { open } = useDiet();
  return (
    <button
      type="button"
      onClick={() => open("food")}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text backdrop-blur-md"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add
    </button>
  );
}

/** Small gold uppercase link used in section headers (opens a sheet). */
export function DietLink({
  kind,
  children,
}: {
  kind: SheetKind;
  children: ReactNode;
}) {
  const { open } = useDiet();
  return (
    <button
      type="button"
      onClick={() => open(kind)}
      className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold"
    >
      {children}
    </button>
  );
}

/** Full-width ghost button used as an empty-state / quick-log affordance. */
export function DietBlockButton({
  kind,
  children,
  className,
}: {
  kind: SheetKind;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useDiet();
  return (
    <button
      type="button"
      onClick={() => open(kind)}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-solid bg-surface px-4 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {children}
    </button>
  );
}

/**
 * A tappable logged-food row. Wraps a rendered food item and opens the food
 * sheet pre-filled for editing the given row (delete lives in the sheet).
 */
export function FoodRow({
  meal,
  children,
  className,
}: {
  meal: NutritionLog;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useDiet();
  return (
    <button
      type="button"
      onClick={() => open("food", { meal })}
      className={cx("block w-full text-left", className)}
      aria-label={`Edit ${meal.meal?.trim() || "food"}`}
    >
      {children}
    </button>
  );
}
