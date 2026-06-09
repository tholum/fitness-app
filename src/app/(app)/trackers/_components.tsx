"use client";

/* ════════════════════════════════════════════════════════════════════
   CUSTOM TRACKERS — client provider, create/edit sheet & logging UI.
   Phase 5. A single provider owns the portaled bottom-sheet (create &
   edit share it) plus the per-card logging affordances, all driven by
   the foundation actions:

     • createTracker / updateTracker — the portaled sheet: title, icon,
       accent, and a cadence picker covering ALL FOUR shapes
       (times_per_week, amount_per_week, specific_weekdays, daily_binary).
     • archiveTracker — soft-delete from the edit sheet.
     • logTracker / unlogTracker — per-card logging appropriate to the
       cadence: increment a count, add an amount, or tick today.

   Each card renders the shared <WeeklyProgress>. Sheets are wrapped in
   <Portal> and use fixed inset-0 z-50 — the app's sheet pattern (mirrors
   /bible · /diet). Never uses window.prompt/alert (global rule); every
   input is an in-page control and every error is an inline note.
   ════════════════════════════════════════════════════════════════════ */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  archiveTracker,
  createTracker,
  logTracker,
  unlogTracker,
  updateTracker,
  type CreateTrackerInput,
  type UpdateTrackerInput,
} from "@/lib/actions";
import { Sheet } from "@/components/Sheet";
import { ErrorNote } from "@/components/ui";
import { cx } from "@/lib/cx";
import { WeekdayPicker } from "@/components/WeekdayPicker";
import {
  WeeklyProgress,
  type WeeklyProgressData,
} from "@/components/WeeklyProgress";
import { todayISO } from "@/lib/format";
import type { CadenceType, Tracker } from "@/lib/types";

/* ── small local helpers ─────────────────────────────────────────────── */

/** Icon palette offered in the sheet (emoji keys persisted to tracker.icon). */
const ICONS = [
  "🎯", "🎸", "📚", "🧘", "🏃", "💧", "🛌", "🧊", "✍️", "🎨",
  "🧠", "💪", "🥗", "☕", "🚴", "🎹", "📝", "🌱", "🔥", "⛰️",
] as const;

/** Accent palette (theme tokens → CSS var color used by the card chip). */
const ACCENTS: ReadonlyArray<{ key: string; color: string }> = [
  { key: "blaze", color: "var(--accent)" },
  { key: "gold", color: "var(--gold)" },
  { key: "moss", color: "var(--accent2)" },
  { key: "slate", color: "#5a7d8c" },
];

function accentColor(accent: string | null | undefined): string {
  const found = ACCENTS.find((a) => a.key === accent);
  return found?.color ?? "var(--accent)";
}

/** The four cadence shapes, with copy for the picker. */
const CADENCES: ReadonlyArray<{
  value: CadenceType;
  title: string;
  sub: string;
}> = [
  { value: "times_per_week", title: "Times / Week", sub: "Hit a weekly count" },
  { value: "amount_per_week", title: "Amount / Week", sub: "Total an amount + unit" },
  { value: "specific_weekdays", title: "Specific Days", sub: "Commit to weekdays" },
  { value: "daily_binary", title: "Every Day", sub: "Did-it daily + streak" },
];

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Context + Provider
   Placed once at the /trackers page root. Owns the open sheet, the
   editing target (null = create), and the form state, and exposes
   logging helpers the cards call. Trigger components read it via context.
   ════════════════════════════════════════════════════════════════════ */

interface TrackersCtx {
  openCreate: () => void;
  openEdit: (tracker: Tracker) => void;
  /** Tick (or untick) today for a binary / weekday tracker. */
  toggleToday: (tracker: Tracker, currentlyDone: boolean) => void;
  /** Add `amount` to today's amount_per_week log (accumulates). */
  addAmount: (tracker: Tracker, amount: number, currentToday: number) => void;
  /** Increment today's times_per_week count by one (one log/day). */
  incrementToday: (tracker: Tracker, currentlyDone: boolean) => void;
  pending: boolean;
}

const Ctx = createContext<TrackersCtx | null>(null);

function useTrackers(): TrackersCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Tracker triggers must be inside <TrackersProvider>");
  return ctx;
}

export function TrackersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Sheet state: `editing` null + sheetOpen true → create; a tracker → edit.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields.
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string>(ICONS[0]);
  const [accent, setAccent] = useState<string>(ACCENTS[0].key);
  const [cadence, setCadence] = useState<CadenceType>("times_per_week");
  const [count, setCount] = useState(3);
  const [amount, setAmount] = useState(120);
  const [unit, setUnit] = useState("min");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);

  function resetForm() {
    setTitle("");
    setIcon(ICONS[0]);
    setAccent(ACCENTS[0].key);
    setCadence("times_per_week");
    setCount(3);
    setAmount(120);
    setUnit("min");
    setWeekdays([1, 3, 5]);
  }

  function openCreate() {
    setError(null);
    setEditing(null);
    resetForm();
    setSheetOpen(true);
  }

  function openEdit(t: Tracker) {
    setError(null);
    setEditing(t);
    setTitle(t.title);
    setIcon(t.icon || ICONS[0]);
    setAccent(t.accent || ACCENTS[0].key);
    setCadence(t.cadence_type);
    setCount(t.weekly_target_count ?? 3);
    setAmount(t.weekly_target_amount ?? 120);
    setUnit(t.unit || "min");
    setWeekdays(t.scheduled_weekdays?.length ? t.scheduled_weekdays : [1, 3, 5]);
    setSheetOpen(true);
  }

  function close() {
    setSheetOpen(false);
    setError(null);
  }

  /* ── Submit the create / edit form ───────────────────────────────────── */
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give your tracker a name.");
      return;
    }
    if (cadence === "specific_weekdays" && weekdays.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    if (cadence === "times_per_week" && count < 1) {
      setError("Weekly count must be at least 1.");
      return;
    }
    if (cadence === "amount_per_week") {
      if (amount <= 0) {
        setError("Weekly amount must be greater than 0.");
        return;
      }
      if (!unit.trim()) {
        setError("Add a unit (e.g. min, pages, km).");
        return;
      }
    }

    // Per-cadence target fields — only the relevant one is meaningful.
    const shared = {
      title: trimmed,
      icon,
      accent,
      cadenceType: cadence,
      weeklyTargetCount: cadence === "times_per_week" ? count : null,
      weeklyTargetAmount: cadence === "amount_per_week" ? amount : null,
      unit: cadence === "amount_per_week" ? unit.trim() : null,
      scheduledWeekdays: cadence === "specific_weekdays" ? weekdays : null,
    };

    startTransition(async () => {
      let res;
      if (editing) {
        res = await updateTracker(editing.id, shared satisfies UpdateTrackerInput);
      } else {
        res = await createTracker({
          type: "custom",
          ...shared,
        } satisfies CreateTrackerInput);
      }
      if (!res.ok) {
        setError(res.error ?? "Could not save tracker.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /* ── Archive (soft-delete) from the edit sheet ───────────────────────── */
  function onArchive() {
    if (!editing) return;
    setError(null);
    const id = editing.id;
    startTransition(async () => {
      const res = await archiveTracker(id, true);
      if (!res.ok) {
        setError(res.error ?? "Could not archive tracker.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /* ── Logging helpers used by the cards ───────────────────────────────── */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
    });
  }

  function toggleToday(tracker: Tracker, currentlyDone: boolean) {
    const date = todayISO();
    run(() =>
      currentlyDone
        ? unlogTracker(tracker.id, date)
        : logTracker({ trackerId: tracker.id, date }),
    );
  }

  function incrementToday(tracker: Tracker, currentlyDone: boolean) {
    // times_per_week is one log/day; a day either counts or it doesn't.
    toggleToday(tracker, currentlyDone);
  }

  function addAmount(tracker: Tracker, delta: number, currentToday: number) {
    const next = Math.max(0, currentToday + delta);
    const date = todayISO();
    run(() =>
      next <= 0
        ? unlogTracker(tracker.id, date)
        : logTracker({ trackerId: tracker.id, date, value: next }),
    );
  }

  // Quick add-amount presets scale to the unit (min vs pages vs reps).
  const sheetTitle = editing ? "Edit Tracker" : "New Tracker";

  return (
    <Ctx.Provider
      value={{
        openCreate,
        openEdit,
        toggleToday,
        addAmount,
        incrementToday,
        pending,
      }}
    >
      {children}

      <Sheet open={sheetOpen} title={sheetTitle} onClose={close}>
        <form onSubmit={onSubmit} className="space-y-5">
          {/* Title */}
          <label className="block">
            <FieldLabel>Name</FieldLabel>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g. Guitar Practice"
              className="w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent"
            />
          </label>

          {/* Icon */}
          <div>
            <FieldLabel>Icon</FieldLabel>
            <div className="grid grid-cols-10 gap-1.5">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  aria-pressed={icon === ic}
                  aria-label={`Icon ${ic}`}
                  onClick={() => setIcon(ic)}
                  className={cx(
                    "flex aspect-square items-center justify-center rounded-[10px] border text-lg transition-colors",
                    icon === ic
                      ? "border-transparent bg-grad"
                      : "border-line bg-surface",
                  )}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Accent */}
          <div>
            <FieldLabel>Accent</FieldLabel>
            <div className="flex gap-2.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={accent === a.key}
                  aria-label={`Accent ${a.key}`}
                  onClick={() => setAccent(a.key)}
                  className={cx(
                    "flex h-10 flex-1 items-center justify-center rounded-[12px] border transition-all",
                    accent === a.key
                      ? "border-text ring-2 ring-text/30"
                      : "border-line",
                  )}
                  style={{ background: a.color }}
                >
                  {accent === a.key ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 fill-none stroke-on-grad [stroke-width:3]"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {/* Cadence */}
          <div>
            <FieldLabel>How is it measured?</FieldLabel>
            <div className="grid grid-cols-2 gap-2.5">
              {CADENCES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={cadence === c.value}
                  onClick={() => setCadence(c.value)}
                  className={cx(
                    "rounded-[16px] border px-3.5 py-3 text-left transition-colors",
                    cadence === c.value
                      ? "border-transparent bg-grad text-on-grad"
                      : "border-line bg-surface text-text",
                  )}
                >
                  <div className="font-display text-[13px] font-bold uppercase tracking-[0.03em]">
                    {c.title}
                  </div>
                  <div
                    className={cx(
                      "text-[11px] leading-tight",
                      cadence === c.value ? "text-on-grad/75" : "text-muted",
                    )}
                  >
                    {c.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Cadence-specific target control */}
          {cadence === "times_per_week" ? (
            <div>
              <FieldLabel>Weekly target</FieldLabel>
              <Stepper
                value={count}
                onChange={setCount}
                min={1}
                max={21}
                suffix="× / week"
              />
            </div>
          ) : null}

          {cadence === "amount_per_week" ? (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label className="block">
                <FieldLabel>Weekly amount</FieldLabel>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={Number.isFinite(amount) ? amount : ""}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <FieldLabel>Unit</FieldLabel>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  maxLength={24}
                  placeholder="min"
                  className="w-24 rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent"
                />
              </label>
            </div>
          ) : null}

          {cadence === "specific_weekdays" ? (
            <div>
              <FieldLabel>Committed days</FieldLabel>
              <WeekdayPicker
                value={weekdays}
                onChange={setWeekdays}
                footer={`${weekdays.length} day${weekdays.length === 1 ? "" : "s"} / week`}
              />
            </div>
          ) : null}

          {cadence === "daily_binary" ? (
            <p className="rounded-[14px] border border-line bg-bg2 px-4 py-3 text-[13px] text-muted">
              Tick it every day to build a streak. Target is all 7 days.
            </p>
          ) : null}

          <ErrorNote message={error} />

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-on-grad shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
          >
            {pending ? "Saving…" : editing ? "Save Changes" : "Create Tracker"}
          </button>

          {editing ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={pending}
              className="w-full rounded-[16px] border border-line bg-surface px-4 py-3 font-cond text-[11px] font-semibold uppercase tracking-wide text-danger disabled:opacity-60"
            >
              Archive Tracker
            </button>
          ) : null}
        </form>
      </Sheet>
    </Ctx.Provider>
  );
}

/* ── Stepper (± with a big centered value) ───────────────────────────── */
function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center justify-center gap-6">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl text-text disabled:opacity-40"
      >
        −
      </button>
      <div className="text-center">
        <div className="font-display text-[44px] font-bold leading-none text-text">
          {value}
        </div>
        <div className="mt-1 font-cond text-[11px] uppercase tracking-wide text-faint">
          {suffix}
        </div>
      </div>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl text-text disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Trigger components rendered by the server page.
   ════════════════════════════════════════════════════════════════════ */

/** Header "+ New" CTA — opens the create sheet. */
export function NewTrackerButton({
  variant = "pill",
  children,
}: {
  variant?: "pill" | "block";
  children?: ReactNode;
}) {
  const { openCreate } = useTrackers();
  if (variant === "block") {
    return (
      <button
        type="button"
        onClick={openCreate}
        className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-on-grad shadow-[0_8px_24px_rgba(200,98,45,.3)]"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current [stroke-width:2.6]">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {children ?? "New Tracker"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openCreate}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text backdrop-blur-md"
      aria-label="New tracker"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]">
        <path d="M12 5v14M5 12h14" />
      </svg>
      New
    </button>
  );
}

/* ── The data shape each card needs (computed server-side). ───────────── */
export interface TrackerCardData {
  tracker: Tracker;
  progress: WeeklyProgressData;
  /** Whether today already has a log (binary / weekday / count). */
  doneToday: boolean;
  /** Today's accumulated amount (amount_per_week only). */
  todayAmount: number;
  /** Current streak (daily_binary / specific_weekdays); 0 otherwise. */
  streak: number;
}

/**
 * A single custom-tracker card: icon + title + cadence summary, the shared
 * WeeklyProgress, a cadence-appropriate logging control, and an edit affordance.
 */
export function TrackerCard({ data }: { data: TrackerCardData }) {
  const { tracker, progress, doneToday, todayAmount, streak } = data;
  const { openEdit, toggleToday, incrementToday, addAmount, pending } =
    useTrackers();

  const accent = accentColor(tracker.accent);
  const cadenceLabel = useMemo(() => cadenceSummary(tracker), [tracker]);

  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface backdrop-blur-md">
      {/* Accent rail */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />

      <div className="p-4 pl-5">
        {/* Header: icon + title + edit */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] text-xl"
            style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)` }}
          >
            {tracker.icon || "🎯"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold uppercase tracking-[0.03em] text-text">
              {tracker.title}
            </div>
            <div className="truncate font-cond text-[11px] uppercase tracking-wide text-faint">
              {cadenceLabel}
              {streak > 0 ? (
                <span className="ml-2 text-gold">
                  🔥 {streak} {tracker.cadence_type === "daily_binary" ? "day" : "wk-day"}
                  {streak === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => openEdit(tracker)}
            aria-label={`Edit ${tracker.title}`}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2]">
              <path d="M4 20h4l10-10-4-4L4 16zM14 6l4 4" />
            </svg>
          </button>
        </div>

        {/* Weekly progress */}
        <div className="mt-4">
          <WeeklyProgress data={progress} ringSize={52} />
        </div>

        {/* Cadence-appropriate logging control */}
        <div className="mt-4">
          {tracker.cadence_type === "amount_per_week" ? (
            <AmountLogger
              unit={tracker.unit || progress.unit || ""}
              today={todayAmount}
              disabled={pending}
              onAdd={(delta) => addAmount(tracker, delta, todayAmount)}
              onClear={() => addAmount(tracker, -todayAmount, todayAmount)}
            />
          ) : tracker.cadence_type === "times_per_week" ? (
            <TickButton
              done={doneToday}
              disabled={pending}
              doneLabel="Done Today — Undo"
              label="Log a Session Today"
              onClick={() => incrementToday(tracker, doneToday)}
            />
          ) : (
            <TickButton
              done={doneToday}
              disabled={pending}
              doneLabel="Done Today — Undo"
              label="Tick Today"
              onClick={() => toggleToday(tracker, doneToday)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tick button (binary / weekday / times_per_week day) ─────────────── */
function TickButton({
  done,
  disabled,
  label,
  doneLabel,
  onClick,
}: {
  done: boolean;
  disabled: boolean;
  label: string;
  doneLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={done}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-3 font-display text-[14px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60",
        done
          ? "border border-line bg-surface text-accent2"
          : "bg-grad text-on-grad shadow-[0_6px_18px_rgba(200,98,45,.28)]",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current [stroke-width:2.6]">
        <path d="M5 13l4 4L19 7" />
      </svg>
      {done ? doneLabel : label}
    </button>
  );
}

/* ── Amount logger (amount_per_week) — quick-add chips + today total ──── */
function AmountLogger({
  unit,
  today,
  disabled,
  onAdd,
  onClear,
}: {
  unit: string;
  today: number;
  disabled: boolean;
  onAdd: (delta: number) => void;
  onClear: () => void;
}) {
  // Preset increments scale to the magnitude implied by the unit label.
  const presets = unit === "min" ? [10, 20, 30] : [5, 10, 25];
  return (
    <div className="rounded-[14px] border border-line bg-bg2 px-3.5 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-cond text-[11px] uppercase tracking-wide text-faint">
          Today
        </span>
        <span className="font-display text-[15px] font-bold text-text">
          {today}
          <span className="font-cond text-xs font-semibold uppercase tracking-wide text-faint">
            {unit ? ` ${unit}` : ""}
          </span>
        </span>
      </div>
      <div className="flex gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(p)}
            className="flex-1 rounded-[12px] bg-grad px-2 py-2.5 font-display text-[13px] font-bold uppercase tracking-wide text-on-grad disabled:opacity-60"
          >
            +{p}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || today <= 0}
          onClick={onClear}
          aria-label="Clear today"
          className="flex w-11 items-center justify-center rounded-[12px] border border-line bg-surface text-muted disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.2]">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Human cadence summary for a card subtitle ───────────────────────── */
function cadenceSummary(t: Tracker): string {
  switch (t.cadence_type) {
    case "times_per_week":
      return `${t.weekly_target_count ?? 0}× per week`;
    case "amount_per_week":
      return `${t.weekly_target_amount ?? 0} ${t.unit ?? ""} / week`.trim();
    case "specific_weekdays":
      return weekdaysLabel(t.scheduled_weekdays);
    case "daily_binary":
      return "Every day";
    default:
      return "";
  }
}

/** Mon-first human label for committed weekdays (Postgres dow 0=Sun..6=Sat). */
function weekdaysLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "No days set";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const set = new Set(days);
  return order
    .filter((d) => set.has(d))
    .map((d) => names[d])
    .join(" · ");
}
