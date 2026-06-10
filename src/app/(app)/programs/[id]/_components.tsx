"use client";

/* ════════════════════════════════════════════════════════════════════
   PROGRAM DETAIL — client subcomponents (gap 5).
   The provider owns the "Add Day" sheet + shared pending/error state and
   exposes createDay / deleteDay / reorderDays / setCurrentDay via context
   (server actions passed in as props). The tree groups program_days by
   Phase → Week, supports drag-reorder, links into each day editor, and lets
   the user mark a day as "Today". Read-only programs hide all editing and
   show a clone CTA instead.
   Bottom-sheet + Field/SubmitBtn/ErrorNote pattern copied from
   src/app/(app)/body/_components.tsx; primitives from src/components/ui.tsx.
   ════════════════════════════════════════════════════════════════════ */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, SubmitBtn, ErrorNote } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { cx } from "@/lib/cx";
import { inviteCrewToProgram } from "@/lib/actions";
import { useConfirm } from "@/components/Confirm";

/* ── shared shapes (kept local so the file is self-contained) ─────────── */
export interface DayRow {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  est_minutes: number | null;
  video_url: string | null;
  order: number;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export type CreateDayFn = (input: {
  programId: string;
  phase: number;
  week: number;
  day: number;
  title: string;
}) => Promise<ActionResult<{ id: string }>>;
export type DeleteDayFn = (id: string, programId: string) => Promise<ActionResult>;
export type ReorderDaysFn = (
  programId: string,
  orderedIds: string[],
) => Promise<ActionResult>;
export type SetCurrentDayFn = (
  programId: string,
  dayId: string,
) => Promise<ActionResult>;
export type CloneFn = (srcId: string) => Promise<ActionResult<{ id: string }>>;

/* ════════════════════════════════════════════════════════════════════
   Field primitives (mirrors body/_components.tsx)
   ════════════════════════════════════════════════════════════════════ */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent";

/* ════════════════════════════════════════════════════════════════════
   Provider
   ════════════════════════════════════════════════════════════════════ */

interface TreeCtx {
  programId: string;
  readOnly: boolean;
  openAddDay: (defaults: { phase: number; week: number; day: number }) => void;
  deleteDay: (id: string) => void;
  reorder: (orderedIds: string[]) => void;
  setToday: (dayId: string) => void;
  pending: boolean;
  busyId: string | null;
}

const Ctx = createContext<TreeCtx | null>(null);

function useTree(): TreeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Must be used inside <ProgramTreeProvider>");
  return ctx;
}

export interface ProgramTreeProviderProps {
  programId: string;
  readOnly: boolean;
  createDayAction: CreateDayFn;
  deleteDayAction: DeleteDayFn;
  reorderDaysAction: ReorderDaysFn;
  setCurrentDayAction: SetCurrentDayFn;
  children: ReactNode;
}

export function ProgramTreeProvider({
  programId,
  readOnly,
  createDayAction,
  deleteDayAction,
  reorderDaysAction,
  setCurrentDayAction,
  children,
}: ProgramTreeProviderProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState({ phase: 1, week: 1, day: 1 });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openAddDay = (d: { phase: number; week: number; day: number }) => {
    setError(null);
    setDefaults(d);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setError(null);
  };

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const phase = Number(fd.get("phase")) || 1;
    const week = Number(fd.get("week")) || 1;
    const day = Number(fd.get("day")) || 1;
    const title = String(fd.get("title") ?? "").trim() || "New Day";
    startTransition(async () => {
      const res = await createDayAction({ programId, phase, week, day, title });
      if (!res.ok || !res.data) {
        setError(res.error ?? "Could not add day.");
        return;
      }
      close();
      router.push(`/programs/${programId}/days/${res.data.id}`);
    });
  }

  function deleteDay(id: string) {
    void confirm({
      title: "Delete day?",
      message: "This removes the day and all its blocks.",
      confirmLabel: "Delete",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setBusyId(id);
      startTransition(async () => {
        await deleteDayAction(id, programId);
        setBusyId(null);
        router.refresh();
      });
    });
  }

  function reorder(orderedIds: string[]) {
    startTransition(async () => {
      await reorderDaysAction(programId, orderedIds);
      router.refresh();
    });
  }

  function setToday(dayId: string) {
    setBusyId(dayId);
    startTransition(async () => {
      await setCurrentDayAction(programId, dayId);
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <Ctx.Provider
      value={{
        programId,
        readOnly,
        openAddDay,
        deleteDay,
        reorder,
        setToday,
        pending,
        busyId,
      }}
    >
      {children}

      <Sheet open={open} title="Add Day" onClose={close}>
        <form onSubmit={onAdd} className="space-y-4">
          <Field label="Title">
            <input
              name="title"
              type="text"
              placeholder="e.g. Lower Body Strength"
              className={inputCls}
            />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Phase">
                <input
                  name="phase"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={defaults.phase}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Week">
                <input
                  name="week"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={defaults.week}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Day">
                <input
                  name="day"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={defaults.day}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>Add Day</SubmitBtn>
        </form>
      </Sheet>
    </Ctx.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Header
   ════════════════════════════════════════════════════════════════════ */

export function ProgramHeader({
  name,
  source,
  readOnly,
}: {
  name: string;
  source: string;
  readOnly: boolean;
}) {
  return (
    <header className="relative z-10 px-0.5 pb-[18px] pt-2">
      <Link
        href="/programs"
        className="mb-2 inline-flex items-center gap-1 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.2]"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Programs
      </Link>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.03em] text-text">
          {name}
        </h1>
        {source === "MTNTOUGH" ? (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-gold">
            MTNTOUGH
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-cond text-[11px] uppercase tracking-[0.12em] text-muted">
        {readOnly ? "Read-only template" : "Tap a day to edit its blocks"}
      </div>
    </header>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Read-only clone CTA
   ════════════════════════════════════════════════════════════════════ */

export function ReadOnlyCloneCTA({
  programId,
  cloneAction,
}: {
  programId: string;
  cloneAction: CloneFn;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function clone() {
    setError(null);
    startTransition(async () => {
      const res = await cloneAction(programId);
      if (res.ok && res.data) {
        router.push(`/programs/${res.data.id}`);
      } else {
        setError(res.error ?? "Could not copy.");
      }
    });
  }

  return (
    <Card className="mb-1 mt-1 p-4">
      <p className="mb-3 text-[13px] text-muted">
        This is a shared template, so it can&apos;t be edited directly. Make a
        copy to customize the schedule, blocks, and exercises.
      </p>
      <button
        type="button"
        onClick={clone}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-[16px] bg-grad px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-on-grad disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 012-2h10" />
        </svg>
        {pending ? "Copying…" : "Make a copy I can edit"}
      </button>
      <ErrorNote message={error} />
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════
   The tree (grouped by Phase → Week, drag-reorder within the flat list)
   ════════════════════════════════════════════════════════════════════ */

interface PhaseGroup {
  phase: number;
  weeks: Array<{ week: number; days: DayRow[] }>;
}

function group(days: DayRow[]): PhaseGroup[] {
  const byPhase = new Map<number, Map<number, DayRow[]>>();
  for (const d of days) {
    const weeks = byPhase.get(d.phase) ?? new Map<number, DayRow[]>();
    const list = weeks.get(d.week) ?? [];
    list.push(d);
    weeks.set(d.week, list);
    byPhase.set(d.phase, weeks);
  }
  return [...byPhase.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, weeks]) => ({
      phase,
      weeks: [...weeks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([week, list]) => ({ week, days: list })),
    }));
}

export function ProgramTree({
  days,
  blockCounts,
  currentDayId,
}: {
  days: DayRow[];
  blockCounts: Record<string, number>;
  currentDayId: string | null;
}) {
  const { programId, readOnly, openAddDay, reorder } = useTree();

  // Local order mirrors props; drag mutates it and we persist on drop.
  const [order, setOrder] = useState<DayRow[]>(days);
  useEffect(() => setOrder(days), [days]);

  const [dragId, setDragId] = useState<string | null>(null);

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = order.findIndex((d) => d.id === dragId);
    const to = order.findIndex((d) => d.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    setDragId(null);
    reorder(next.map((d) => d.id));
  }

  if (order.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="mb-3 text-[13px] text-muted">
          {readOnly
            ? "This template has no days yet."
            : "No days yet. Add the program's first training day to start building the schedule."}
        </p>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => openAddDay({ phase: 1, week: 1, day: 1 })}
            className="inline-flex items-center gap-2 rounded-[16px] bg-grad px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-on-grad"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add first day
          </button>
        ) : null}
      </Card>
    );
  }

  const groups = group(order);

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.phase}>
          <div className="mx-1 mb-2 font-display text-sm font-semibold uppercase tracking-[0.094em] text-gold">
            Phase {g.phase}
          </div>
          <div className="space-y-4">
            {g.weeks.map((w) => (
              <div key={w.week}>
                <div className="mx-1 mb-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Week {w.week}
                </div>
                <div className="space-y-2">
                  {w.days.map((d) => (
                    <DayTreeRow
                      key={d.id}
                      programId={programId}
                      day={d}
                      blockCount={blockCounts[d.id] ?? 0}
                      isToday={d.id === currentDayId}
                      readOnly={readOnly}
                      draggable={!readOnly && order.length > 1}
                      onDragStart={() => setDragId(d.id)}
                      onDropRow={() => onDrop(d.id)}
                      dragging={dragId === d.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!readOnly ? (
        <button
          type="button"
          onClick={() => {
            const last = order[order.length - 1];
            openAddDay({
              phase: last?.phase ?? 1,
              week: last?.week ?? 1,
              day: (last?.day ?? 0) + 1,
            });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-solid bg-surface px-4 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add day
        </button>
      ) : null}
    </div>
  );
}

function DayTreeRow({
  programId,
  day,
  blockCount,
  isToday,
  readOnly,
  draggable,
  dragging,
  onDragStart,
  onDropRow,
}: {
  programId: string;
  day: DayRow;
  blockCount: number;
  isToday: boolean;
  readOnly: boolean;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDropRow: () => void;
}) {
  const { deleteDay, setToday, busyId, pending } = useTree();
  const busy = pending && busyId === day.id;

  const metaParts: string[] = [`Day ${day.day}`];
  if (blockCount) metaParts.push(`${blockCount} ${blockCount === 1 ? "block" : "blocks"}`);
  if (day.est_minutes) metaParts.push(`~${day.est_minutes} min`);

  return (
    <Card
      className={cx("p-3", dragging && "opacity-50", isToday && "border-accent")}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDropRow();
      }}
    >
      <div className="flex items-center gap-2.5">
        {draggable ? (
          <span
            aria-hidden
            className="flex-shrink-0 cursor-grab text-faint [&_svg]:h-4 [&_svg]:w-4"
            title="Drag to reorder"
          >
            <svg viewBox="0 0 24 24" className="fill-none stroke-current [stroke-width:2]">
              <circle cx="9" cy="6" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="18" r="1" />
              <circle cx="15" cy="6" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="18" r="1" />
            </svg>
          </span>
        ) : null}

        <Link
          href={`/programs/${programId}/days/${day.id}`}
          className="min-w-0 flex-1"
        >
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-sm font-semibold uppercase tracking-[0.03em] text-text">
              {day.title}
            </span>
            {isToday ? (
              <span className="flex-shrink-0 rounded-full bg-accent2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-on-grad">
                Today
              </span>
            ) : null}
            {day.video_url ? (
              <svg
                viewBox="0 0 24 24"
                aria-label="Has video"
                className="h-3.5 w-3.5 flex-shrink-0 fill-gold"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-muted">{metaParts.join(" · ")}</div>
        </Link>

        {!readOnly ? (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setToday(day.id)}
              disabled={busy || isToday}
              aria-label="Set as today"
              title={isToday ? "Current day" : "Make this Today"}
              className={cx(
                "flex h-8 w-8 items-center justify-center rounded-full border text-muted disabled:opacity-50",
                isToday ? "border-accent bg-accent/[0.18]" : "border-line bg-surface2",
              )}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current [stroke-width:2]"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => deleteDay(day.id)}
              disabled={busy}
              aria-label="Delete day"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface2 text-danger disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
              >
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        ) : (
          <span className="font-display text-gold">›</span>
        )}
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Invite crew to this program
   Posts a program_invite into the active crew's feed (server resolves the
   crew); members accept from /crew to get their own copy + enrollment.
   Rendered only when the viewer is in a crew.
   ════════════════════════════════════════════════════════════════════ */

export function InviteCrewButton({ programId }: { programId: string }) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function invite() {
    if (sent || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await inviteCrewToProgram(programId);
      if (!res.ok) {
        setError(res.error ?? "Could not invite your crew.");
        return;
      }
      setSent(true);
    });
  }

  return (
    <div className="mb-3.5">
      <button
        type="button"
        onClick={invite}
        disabled={sent || pending}
        className={cx(
          "inline-flex items-center gap-2 rounded-[14px] border px-3.5 py-2.5 font-display text-xs font-semibold uppercase tracking-wide disabled:opacity-80",
          sent
            ? "border-transparent bg-accent2 text-on-grad"
            : "border-line bg-surface text-text",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
        >
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1M15 14h1a4 4 0 014 4v2" />
        </svg>
        {sent ? "✓ Invite posted to crew" : pending ? "Inviting…" : "Invite crew to this program"}
      </button>
      <ErrorNote message={error} />
    </div>
  );
}
