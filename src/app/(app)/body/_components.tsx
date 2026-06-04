"use client";

/* ════════════════════════════════════════════════════════════════════
   BODY & FUEL — client log affordances.
   A single provider holds the modal state + renders the inline bottom-
   sheet forms that call the logBody / logMeal / logWater server actions,
   plus their edit/correct siblings (updateMeal / deleteMeal / setWater /
   clearWater). Small trigger components (rendered inline by the server
   page) open the relevant sheet via context — passing an editing payload
   (a meal to edit, or a date to re-log body metrics for). Styling is
   strictly theme-token Tailwind so it re-skins with the active
   theme/accent, matching the BASECAMP look.
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
  logBody,
  logMeal,
  updateMeal,
  deleteMeal,
  logWater,
  setWater,
  clearWater,
} from "@/lib/actions";
import { todayISO } from "@/lib/format";
import type { Units, NutritionLog } from "@/lib/types";

/* ── small local helpers ─────────────────────────────────────────────── */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Parse a form input into a number, returning null for blank/invalid. */
function num(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Convert a stored ml total to the user's display unit (for the "set total" field). */
function mlToDisplay(ml: number, units: Units): number {
  if (units === "imperial") return Math.round(ml / 29.5735295625); // oz
  return Math.round((ml / 1000) * 100) / 100; // L, 2dp
}

/** Convert a display-unit water amount back to ml (for setWater). */
function displayToMl(value: number, units: Units): number {
  if (units === "imperial") return Math.round(value * 29.5735295625);
  return Math.round(value * 1000);
}

/* ── Sheet (lightweight modal) ───────────────────────────────────────── */

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom-anchored modal sheet, centered within the phone column. */
function Sheet({ open, title, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-card border border-b-0 border-line-solid bg-surface-solid px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-20px_60px_rgba(0,0,0,.6)]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-solid" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase tracking-[0.04em] text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-none stroke-current [stroke-width:2.2]"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
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

function SubmitBtn({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="font-cond text-xs font-semibold uppercase tracking-wide text-danger">
      {message}
    </p>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Context + Provider
   The provider is placed once at the page root. It owns the open sheet,
   an optional editing payload, the pending/error state, and renders all
   forms. Trigger buttons (also client components, rendered inline by the
   server page within this provider's subtree) call open(...) via context.
   ════════════════════════════════════════════════════════════════════ */

type SheetKind = "body" | "meal" | "water";

/** Payload carried when opening a sheet for editing/contextual logging. */
interface OpenOpts {
  /** Meal row to edit (meal sheet → update branch + delete affordance). */
  meal?: NutritionLog;
  /** Explicit date to (re-)log body metrics for (body sheet history flow). */
  date?: string;
}

interface LoggerCtx {
  open: (kind: SheetKind, opts?: OpenOpts) => void;
}

const LoggerContext = createContext<LoggerCtx | null>(null);

function useLogger(): LoggerCtx {
  const ctx = useContext(LoggerContext);
  if (!ctx) throw new Error("Body log triggers must be inside <BodyLogProvider>");
  return ctx;
}

export interface BodyLogProviderProps {
  units: Units;
  /** Latest metrics (in the user's display units) to prefill the form. */
  currentWeight: number | null;
  currentBodyFat: number | null;
  currentWaist: number | null;
  /** Today's stored water total in ml (to prefill the "set total" field). */
  currentWaterMl: number;
  children: ReactNode;
}

export function BodyLogProvider({
  units,
  currentWeight,
  currentBodyFat,
  currentWaist,
  currentWaterMl,
  children,
}: BodyLogProviderProps) {
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // The meal currently being edited (null = a fresh "add meal" flow).
  const [editingMeal, setEditingMeal] = useState<NutritionLog | null>(null);
  // The date the body sheet should write to (defaults to today; the History
  // flow opens it with an explicit past/other date).
  const [bodyDate, setBodyDate] = useState<string>(todayISO());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = (kind: SheetKind, opts?: OpenOpts) => {
    setError(null);
    setEditingMeal(kind === "meal" ? opts?.meal ?? null : null);
    if (kind === "body") setBodyDate(opts?.date ?? todayISO());
    setSheet(kind);
  };
  const close = () => {
    setSheet(null);
    setEditingMeal(null);
    setError(null);
  };

  const weightUnit = units === "imperial" ? "lb" : "kg";
  const lengthUnit = units === "imperial" ? "in" : "cm";
  const volumeUnit = units === "imperial" ? "oz" : "L";
  // Water quick-add steps, sized per unit (≈8 oz cup / 250 ml).
  const waterSteps =
    units === "imperial"
      ? [
          { label: "+8 oz", ml: 237 },
          { label: "+16 oz", ml: 473 },
          { label: "+1 qt", ml: 946 },
        ]
      : [
          { label: "+250 ml", ml: 250 },
          { label: "+500 ml", ml: 500 },
          { label: "+1 L", ml: 1000 },
        ];
  // A single "undo last cup" step for the minus quick-action (one cup unit).
  const waterUndoMl = units === "imperial" ? 237 : 250;
  const waterUndoLabel = units === "imperial" ? "−8 oz" : "−250 ml";

  function onBodySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    // Values are entered + stored in the user's display unit (no conversion);
    // the page formats them back with assumeMetric:false for consistency.
    const input = {
      date: bodyDate,
      weight: num(fd.get("weight")),
      bodyFat: num(fd.get("bodyFat")),
      waist: num(fd.get("waist")),
    };
    if (input.weight == null && input.bodyFat == null && input.waist == null) {
      setError("Enter at least one value.");
      return;
    }
    startTransition(async () => {
      // logBody upserts on (user_id, date), so re-saving a past day's row from
      // the History flow corrects it in place.
      const res = await logBody(input);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onMealSubmit(e: FormEvent<HTMLFormElement>) {
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
      // Branch insert vs update on the editing-id from context.
      const res = id ? await updateMeal(id, input) : await logMeal(input);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onMealDelete() {
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

  /** Add (or subtract, with a negative delta) water relative to today's total. */
  function addWater(ml: number) {
    setError(null);
    startTransition(async () => {
      const res = await logWater(ml);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /** Set today's water to an exact display-unit amount (→ ml via setWater). */
  function onSetWater(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const display = num(fd.get("total"));
    if (display == null || display < 0) {
      setError("Enter an amount.");
      return;
    }
    startTransition(async () => {
      const res = await setWater(displayToMl(display, units));
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /** Reset today's water total to 0. */
  function onClearWater() {
    setError(null);
    startTransition(async () => {
      const res = await clearWater();
      if (!res.ok) {
        setError(res.error ?? "Could not clear.");
        return;
      }
      close();
      router.refresh();
    });
  }

  const editing = editingMeal != null;

  return (
    <LoggerContext.Provider value={{ open }}>
      {children}

      {/* ── Body metrics sheet ── */}
      <Sheet
        open={sheet === "body"}
        title={bodyDate === todayISO() ? "Log Body Metrics" : "Edit Body Metrics"}
        onClose={close}
      >
        <form onSubmit={onBodySubmit} className="space-y-4">
          <Field label="Date">
            {/* logBody upserts on (user_id, date); changing this re-saves the
                chosen day rather than today — powering the History edit flow.
                Controlled (value, not defaultValue) so typing isn't disrupted
                and the value drives the sheet title + past-day hint. */}
            <input
              name="date"
              type="date"
              value={bodyDate}
              max={todayISO()}
              onChange={(ev) => setBodyDate(ev.currentTarget.value || todayISO())}
              className={inputCls}
            />
          </Field>
          <Field label="Bodyweight" suffix={weightUnit}>
            <input
              name="weight"
              type="number"
              inputMode="decimal"
              step="0.1"
              defaultValue={currentWeight ?? ""}
              placeholder="0.0"
              className={inputCls}
              autoFocus
            />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Waist" suffix={lengthUnit}>
                <input
                  name="waist"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  defaultValue={currentWaist ?? ""}
                  placeholder="0.0"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Body Fat" suffix="%">
                <input
                  name="bodyFat"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  defaultValue={currentBodyFat ?? ""}
                  placeholder="0.0"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
          {bodyDate !== todayISO() ? (
            <p className="font-cond text-[11px] uppercase tracking-wide text-faint">
              Editing a past day. Prefilled values are today&apos;s latest — adjust
              before saving.
            </p>
          ) : null}
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>Save Metrics</SubmitBtn>
        </form>
      </Sheet>

      {/* ── Meal sheet (add OR edit) ── */}
      <Sheet
        open={sheet === "meal"}
        title={editing ? "Edit Fuel" : "Log Fuel"}
        onClose={close}
      >
        {/* key forces the uncontrolled inputs to re-init their defaultValues
            when switching between add and editing different meals. */}
        <form
          key={editingMeal?.id ?? "new"}
          onSubmit={onMealSubmit}
          className="space-y-4"
        >
          <Field label="Meal">
            <input
              name="meal"
              type="text"
              defaultValue={editingMeal?.meal ?? ""}
              placeholder="e.g. Lunch — elk, rice, greens"
              className={inputCls}
              autoFocus
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
          <SubmitBtn pending={pending}>{editing ? "Save Meal" : "Add Meal"}</SubmitBtn>
          {editing ? (
            <button
              type="button"
              onClick={onMealDelete}
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.06em] text-danger disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current [stroke-width:2]"
              >
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
              </svg>
              Delete Meal
            </button>
          ) : null}
        </form>
      </Sheet>

      {/* ── Water sheet (add · correct · set · clear) ── */}
      <Sheet open={sheet === "water"} title="Log Water" onClose={close}>
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="font-cond text-xs font-semibold uppercase tracking-wide text-muted">
              Tap to add to today&apos;s total
            </p>
            <div className="grid grid-cols-3 gap-3">
              {waterSteps.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={pending}
                  onClick={() => addWater(s.ml)}
                  className="rounded-[16px] border border-line bg-surface2 px-2 py-4 font-display text-[15px] font-bold uppercase tracking-wide text-text disabled:opacity-60"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Correction quick-action: subtract one cup (logWater w/ negative). */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending || currentWaterMl <= 0}
              onClick={() => addWater(-waterUndoMl)}
              className="flex flex-1 items-center justify-center gap-2 rounded-[16px] border border-line bg-surface px-2 py-3 font-display text-sm font-bold uppercase tracking-wide text-muted disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
              >
                <path d="M5 12h14" />
              </svg>
              {waterUndoLabel}
            </button>
            <button
              type="button"
              disabled={pending || currentWaterMl <= 0}
              onClick={onClearWater}
              className="flex flex-1 items-center justify-center rounded-[16px] border border-line bg-surface px-2 py-3 font-display text-sm font-bold uppercase tracking-wide text-danger disabled:opacity-40"
            >
              Clear Today
            </button>
          </div>

          {/* Exact total entry → setWater. */}
          <form onSubmit={onSetWater} className="space-y-3 border-t border-line pt-4">
            <Field label="Set total" suffix={volumeUnit}>
              <input
                key={`water-${currentWaterMl}`}
                name="total"
                type="number"
                inputMode="decimal"
                step={units === "imperial" ? "1" : "0.1"}
                min="0"
                defaultValue={currentWaterMl > 0 ? mlToDisplay(currentWaterMl, units) : ""}
                placeholder="0"
                className={inputCls}
              />
            </Field>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.06em] text-text disabled:opacity-60"
            >
              {pending ? "Saving…" : "Set Total"}
            </button>
          </form>

          <ErrorNote message={error} />
        </div>
      </Sheet>
    </LoggerContext.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Trigger components (rendered inline by the server page).
   ════════════════════════════════════════════════════════════════════ */

/** Header "+ Log" pill → opens the body-metrics sheet (today). */
export function LogMetricsPill() {
  const { open } = useLogger();
  return (
    <button
      type="button"
      onClick={() => open("body")}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text backdrop-blur-md"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      Log
    </button>
  );
}

/** Small gold uppercase link used in section headers (e.g. "+ Add"). */
export function LogLink({
  kind,
  children,
}: {
  kind: SheetKind;
  children: ReactNode;
}) {
  const { open } = useLogger();
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

/**
 * "History" link in the Body Metrics header (gap 17). Opens the body sheet
 * with a date picker defaulted to yesterday, so a past day's measurement can
 * be (re-)saved. logBody upserts on (user_id, date), so this corrects/creates
 * the chosen day in place. Reuses the existing Sheet/Field/SubmitBtn primitives.
 */
export function BodyHistoryLink({ children }: { children: ReactNode }) {
  const { open } = useLogger();
  return (
    <button
      type="button"
      onClick={() => open("body", { date: yesterdayISO() })}
      className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold"
    >
      {children}
    </button>
  );
}

/** Yesterday as a local ISO date (sensible default target for the History flow). */
function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Full-width ghost button used as an empty-state / quick-log affordance. */
export function LogBlockButton({
  kind,
  children,
  className,
}: {
  kind: SheetKind;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useLogger();
  return (
    <button
      type="button"
      onClick={() => open(kind)}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-solid bg-surface px-4 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      {children}
    </button>
  );
}

/** A tappable row that opens a sheet — used for the body + water tracker rows. */
export function LogRow({
  kind,
  children,
  className,
}: {
  kind: SheetKind;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useLogger();
  return (
    <button
      type="button"
      onClick={() => open(kind)}
      className={cx("block w-full text-left", className)}
    >
      {children}
    </button>
  );
}

/**
 * A tappable logged-meal row (gap 15). Wraps a rendered meal LogItem and opens
 * the meal sheet pre-filled for editing the given row. The whole row is the
 * edit trigger; the meal sheet itself carries the delete affordance.
 */
export function MealRow({
  meal,
  children,
  className,
}: {
  meal: NutritionLog;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useLogger();
  return (
    <button
      type="button"
      onClick={() => open("meal", { meal })}
      className={cx("block w-full text-left", className)}
      aria-label={`Edit ${meal.meal?.trim() || "meal"}`}
    >
      {children}
    </button>
  );
}
