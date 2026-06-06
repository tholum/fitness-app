"use client";

/* ════════════════════════════════════════════════════════════════════
   BIBLE READING — client log + setup affordances (Phase 3).
   A single provider owns the portaled bottom-sheets for the dedicated
   /bible screen and the "mark read" affordances:

     • "mark"     → logTracker / unlogTracker for a given day (today by
                    default). Daily mark-read; the binary "did I read".
     • "schedule" → edit the reading cadence: daily (daily_binary) or
                    specific weekdays (specific_weekdays + WeekdayPicker).
                    Creates the singleton bible tracker if it doesn't exist.
     • "plan"     → attach / change / clear a built-in reading plan. The
                    chosen plan ref is stored in tracker.config.plan
                    ({ id, name, startDate }) — config-only, no extra schema.

   Reuses the foundation: createTracker / updateTracker / logTracker /
   unlogTracker (actions.ts), WeekdayPicker (components), and the built-in
   plan catalog (lib/biblePlans). Sheets are wrapped in <Portal> and use
   fixed inset-0 z-50 — the app's sheet pattern (mirrors /diet).
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
  createTracker,
  updateTracker,
  logTracker,
  unlogTracker,
} from "@/lib/actions";
import { Portal } from "@/components/Portal";
import { WeekdayPicker } from "@/components/WeekdayPicker";
import { BIBLE_PLANS, getPlan, resolveTodaysReading } from "@/lib/biblePlans";
import type { CadenceType, Json, Tracker } from "@/lib/types";
import { todayISO } from "@/lib/format";

/* ── small local helpers ─────────────────────────────────────────────── */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Sheet (portaled bottom-anchored modal) — mirrors /diet ──────────── */

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function Sheet({ open, title, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <Portal>
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
        <div className="relative z-10 max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-card border border-b-0 border-line-solid bg-surface-solid px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-20px_60px_rgba(0,0,0,.6)]">
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
    </Portal>
  );
}

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
   Placed once at the /bible page root. Owns the open sheet, pending/error
   state, the current tracker, and renders the mark / schedule / plan
   forms. Trigger components call open(...) via context.
   ════════════════════════════════════════════════════════════════════ */

type SheetKind = "schedule" | "plan";

interface BibleCtx {
  open: (kind: SheetKind) => void;
  /** Toggle a day's read-log (defaults to today). */
  toggleDay: (date: string, currentlyDone: boolean) => void;
  pending: boolean;
}

const BibleContext = createContext<BibleCtx | null>(null);

function useBible(): BibleCtx {
  const ctx = useContext(BibleContext);
  if (!ctx) throw new Error("Bible triggers must be inside <BibleProvider>");
  return ctx;
}

export interface BibleProviderProps {
  /** Existing singleton bible tracker, or null if not yet created. */
  tracker: Tracker | null;
  children: ReactNode;
}

export function BibleProvider({ tracker, children }: BibleProviderProps) {
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Schedule form local state.
  const initialCadence: CadenceType =
    tracker?.cadence_type === "specific_weekdays" ? "specific_weekdays" : "daily_binary";
  const [cadence, setCadence] = useState<CadenceType>(initialCadence);
  const [weekdays, setWeekdays] = useState<number[]>(
    tracker?.scheduled_weekdays ?? [1, 2, 3, 4, 5, 6, 0],
  );

  // Plan form local state.
  const [planId, setPlanId] = useState<string>(
    (() => {
      const cfg = (tracker?.config ?? {}) as Record<string, unknown>;
      const plan = cfg.plan as Record<string, unknown> | null | undefined;
      const id = plan && typeof plan.id === "string" ? plan.id : "";
      return getPlan(id) ? id : "";
    })(),
  );
  const [startDate, setStartDate] = useState<string>(todayISO());

  const open = (kind: SheetKind) => {
    setError(null);
    setSheet(kind);
  };
  const close = () => {
    setSheet(null);
    setError(null);
  };

  /* ── Mark / unmark a day's reading (daily binary log) ────────────────── */
  function toggleDay(date: string, currentlyDone: boolean) {
    if (!tracker) {
      // No tracker yet — nudge the user to set up a schedule first.
      open("schedule");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = currentlyDone
        ? await unlogTracker(tracker.id, date)
        : await logTracker({ trackerId: tracker.id, date });
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      router.refresh();
    });
  }

  /* ── Schedule (cadence) — create or update the bible tracker ──────────── */
  function onScheduleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (cadence === "specific_weekdays" && weekdays.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    const scheduledWeekdays = cadence === "specific_weekdays" ? weekdays : null;
    startTransition(async () => {
      const res = tracker
        ? await updateTracker(tracker.id, {
            cadenceType: cadence,
            scheduledWeekdays,
          })
        : await createTracker({
            type: "bible",
            title: "Bible Reading",
            cadenceType: cadence,
            scheduledWeekdays,
            config: { plan: null },
          });
      if (!res.ok) {
        setError(res.error ?? "Could not save schedule.");
        return;
      }
      close();
      router.refresh();
    });
  }

  /* ── Plan — attach / change / clear the reading plan (config.plan) ────── */
  function savePlan(nextPlanId: string) {
    setError(null);
    const plan = getPlan(nextPlanId);
    const config: Json = {
      ...((tracker?.config as Record<string, Json>) ?? {}),
      plan: plan ? { id: plan.id, name: plan.name, startDate } : null,
    };
    startTransition(async () => {
      // The bible tracker should already exist (schedule sets it up); if not,
      // create it with the default daily cadence so a plan can attach.
      const res = tracker
        ? await updateTracker(tracker.id, { config })
        : await createTracker({
            type: "bible",
            title: "Bible Reading",
            cadenceType: "daily_binary",
            config,
          });
      if (!res.ok) {
        setError(res.error ?? "Could not save plan.");
        return;
      }
      close();
      router.refresh();
    });
  }

  // Live preview of the chosen plan's day-1 / today passage in the picker.
  const previewReading =
    planId && getPlan(planId)
      ? resolveTodaysReading(
          { id: planId, name: getPlan(planId)!.name, startDate },
          todayISO(),
        )
      : null;

  return (
    <BibleContext.Provider value={{ open, toggleDay, pending }}>
      {children}

      {/* ── Schedule sheet (cadence) ── */}
      <Sheet open={sheet === "schedule"} title="Reading Schedule" onClose={close}>
        <form onSubmit={onScheduleSubmit} className="space-y-4">
          <p className="font-cond text-[11px] uppercase tracking-wide text-faint">
            How often do you want to read?
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <CadenceChip
              active={cadence === "daily_binary"}
              onClick={() => setCadence("daily_binary")}
              title="Every Day"
              sub="A daily streak"
            />
            <CadenceChip
              active={cadence === "specific_weekdays"}
              onClick={() => setCadence("specific_weekdays")}
              title="Specific Days"
              sub="Pick weekdays"
            />
          </div>

          {cadence === "specific_weekdays" ? (
            <div>
              <span className="mb-2 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
                Reading days
              </span>
              <WeekdayPicker
                value={weekdays}
                onChange={setWeekdays}
                footer={`${weekdays.length} day${weekdays.length === 1 ? "" : "s"} / week`}
              />
            </div>
          ) : null}

          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>
            {tracker ? "Save Schedule" : "Start Reading"}
          </SubmitBtn>
        </form>
      </Sheet>

      {/* ── Plan sheet (config.plan) ── */}
      <Sheet open={sheet === "plan"} title="Reading Plan" onClose={close}>
        <div className="space-y-3">
          <p className="font-cond text-[11px] uppercase tracking-wide text-faint">
            Optional — a plan suggests today&apos;s passage. You still mark each day read.
          </p>

          <div className="space-y-2.5">
            {BIBLE_PLANS.map((p) => {
              const on = planId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlanId(on ? "" : p.id)}
                  aria-pressed={on}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[16px] border px-4 py-3.5 text-left transition-colors",
                    on
                      ? "border-transparent bg-grad text-bg"
                      : "border-line bg-surface text-text",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14px] font-bold uppercase tracking-[0.03em]">
                      {p.name}
                    </div>
                    <div
                      className={cx(
                        "truncate text-xs",
                        on ? "text-bg/75" : "text-muted",
                      )}
                    >
                      {p.blurb} · {p.days.length} days
                    </div>
                  </div>
                  {on ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 flex-shrink-0 fill-none stroke-current [stroke-width:2.6]"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>

          {planId ? (
            <label className="block">
              <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
                Start date
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value || todayISO())}
                className="w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none focus:border-accent"
              />
            </label>
          ) : null}

          {previewReading ? (
            <div className="rounded-[14px] border border-line bg-bg2 px-4 py-3">
              <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
                Today would be
              </div>
              <div className="mt-0.5 font-display text-[15px] font-bold text-text">
                {previewReading.passage}
              </div>
              <div className="font-cond text-[10px] uppercase tracking-wide text-faint">
                Day {previewReading.dayNumber} of {previewReading.total}
                {previewReading.notStarted ? " · starts later" : ""}
                {previewReading.finished ? " · plan complete" : ""}
              </div>
            </div>
          ) : null}

          <ErrorNote message={error} />

          <button
            type="button"
            onClick={() => savePlan(planId)}
            disabled={pending}
            className="mt-1 w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
          >
            {pending ? "Saving…" : planId ? "Use This Plan" : "No Plan (Just Mark Read)"}
          </button>
        </div>
      </Sheet>
    </BibleContext.Provider>
  );
}

/* ── Cadence selector chip (schedule sheet) ──────────────────────────── */
function CadenceChip({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-[16px] border px-4 py-3.5 text-left transition-colors",
        active ? "border-transparent bg-grad text-bg" : "border-line bg-surface text-text",
      )}
    >
      <div className="font-display text-[14px] font-bold uppercase tracking-[0.03em]">
        {title}
      </div>
      <div className={cx("text-xs", active ? "text-bg/75" : "text-muted")}>{sub}</div>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Trigger components (rendered inline by the server page).
   ════════════════════════════════════════════════════════════════════ */

/** Header pill → opens the schedule sheet. */
export function SchedulePill() {
  const { open } = useBible();
  return (
    <button
      type="button"
      onClick={() => open("schedule")}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text backdrop-blur-md"
      aria-label="Edit reading schedule"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.2]">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </svg>
      Schedule
    </button>
  );
}

/** Small gold uppercase link used in section headers (opens a sheet). */
export function BibleLink({ kind, children }: { kind: SheetKind; children: ReactNode }) {
  const { open } = useBible();
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

/** Full-width ghost button used as an empty-state / setup affordance. */
export function BibleBlockButton({
  kind,
  children,
  className,
}: {
  kind: SheetKind;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useBible();
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
 * The primary "mark today read" button (or "Read ✓ — undo" once done).
 * Drives logTracker / unlogTracker for today via context.
 */
export function MarkReadButton({
  date,
  done,
  label,
}: {
  /** Day to toggle (ISO). Defaults to today at the call site. */
  date: string;
  done: boolean;
  /** Optional override label for the not-yet-done state. */
  label?: string;
}) {
  const { toggleDay, pending } = useBible();
  return (
    <button
      type="button"
      onClick={() => toggleDay(date, done)}
      disabled={pending}
      aria-pressed={done}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] transition-colors disabled:opacity-60",
        done
          ? "border border-line bg-surface text-moss"
          : "bg-grad text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)]",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current [stroke-width:2.6]">
        <path d="M5 13l4 4L19 7" />
      </svg>
      {done ? "Read Today — Tap to Undo" : label ?? "Mark Read"}
    </button>
  );
}

/**
 * A tappable day dot in the week strip — toggles that day's read-log.
 * `filled` = logged, `scheduled` = a committed-but-unmet day (specific_weekdays).
 */
export function WeekDayToggle({
  date,
  label,
  filled,
  scheduled,
  isToday,
}: {
  date: string;
  label: string;
  filled: boolean;
  scheduled: boolean;
  isToday: boolean;
}) {
  const { toggleDay, pending } = useBible();
  return (
    <button
      type="button"
      onClick={() => toggleDay(date, filled)}
      disabled={pending}
      aria-pressed={filled}
      aria-label={`${label}${filled ? " — read" : ""}`}
      className="flex flex-1 flex-col items-center gap-1.5 disabled:opacity-60"
    >
      <span
        className={cx(
          "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
          filled
            ? "border-transparent bg-grad text-bg"
            : scheduled
              ? "border-accent2/50 bg-accent2/10 text-muted"
              : "border-line bg-surface text-faint",
          isToday && !filled ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : "",
        )}
      >
        {filled ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2.8]">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="font-display text-[13px] font-bold">{label[0]}</span>
        )}
      </span>
      <span className="font-cond text-[9px] uppercase leading-none text-faint">{label}</span>
    </button>
  );
}
