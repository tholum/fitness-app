"use client";

/* ════════════════════════════════════════════════════════════════════
   DAY EDITOR — client subcomponents (gaps 2, 7).
   One <DayEditor> renders:
     • the day-fields form (title/phase/week/day/est_minutes + MTNTOUGH
       video URL) wired to updateDay;
     • a block list with create/edit/delete + drag-reorder;
     • within each block, an exercise-row list with create/edit/delete +
       drag-reorder, where each row picks a library exercise (→ exercise_id
       + name) or types a custom name, plus sets/reps/load/distance/time/
       rest/notes.
   All mutations are server actions passed in as props. Bottom-sheet +
   Field/SubmitBtn/ErrorNote pattern copied from
   src/app/(app)/body/_components.tsx; primitives from src/components/ui.tsx.
   ════════════════════════════════════════════════════════════════════ */

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader } from "@/components/ui";
import { validateVideoUrl } from "@/lib/format";

/* ── shared shapes (kept local so the file is self-contained) ─────────── */
export type BlockType =
  | "warmup"
  | "strength"
  | "conditioning"
  | "mobility"
  | "other";

export interface DayData {
  id: string;
  program_id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  est_minutes: number | null;
  video_url: string | null;
}

export interface ExerciseRowData {
  id: string;
  program_block_id: string;
  exercise_id: string | null;
  name: string;
  sets: number | null;
  reps: string | null;
  load: string | null;
  distance: string | null;
  time: string | null;
  rest: string | null;
  notes: string | null;
  order: number;
}

export interface BlockData {
  id: string;
  label: string;
  type: BlockType;
  detail: string | null;
  order: number;
  rows: ExerciseRowData[];
}

export interface LibraryExercise {
  id: string;
  name: string;
  category: BlockType;
  default_video_url: string | null;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface ExerciseRowInput {
  exerciseId: string | null;
  name: string;
  sets: number | null;
  reps: string | null;
  load: string | null;
  distance: string | null;
  time: string | null;
  rest: string | null;
  notes: string | null;
}

export interface DayEditorProps {
  programId: string;
  readOnly: boolean;
  day: DayData;
  blocks: BlockData[];
  blockTypes: ReadonlyArray<BlockType>;
  library: LibraryExercise[];
  updateDayAction: (
    dayId: string,
    programId: string,
    input: {
      title: string;
      phase: number;
      week: number;
      day: number;
      estMinutes: number | null;
      videoUrl: string | null;
    },
  ) => Promise<ActionResult>;
  createBlockAction: (
    dayId: string,
    programId: string,
    input: { label: string; type: BlockType; detail: string | null },
  ) => Promise<ActionResult<{ id: string }>>;
  updateBlockAction: (
    blockId: string,
    programId: string,
    dayId: string,
    input: { label: string; type: BlockType; detail: string | null },
  ) => Promise<ActionResult>;
  deleteBlockAction: (
    blockId: string,
    programId: string,
    dayId: string,
  ) => Promise<ActionResult>;
  reorderBlocksAction: (
    programId: string,
    dayId: string,
    orderedIds: string[],
  ) => Promise<ActionResult>;
  createExerciseRowAction: (
    blockId: string,
    programId: string,
    dayId: string,
    input: ExerciseRowInput,
  ) => Promise<ActionResult<{ id: string }>>;
  updateExerciseRowAction: (
    rowId: string,
    programId: string,
    dayId: string,
    input: ExerciseRowInput,
  ) => Promise<ActionResult>;
  deleteExerciseRowAction: (
    rowId: string,
    programId: string,
    dayId: string,
  ) => Promise<ActionResult>;
  reorderExerciseRowsAction: (
    programId: string,
    dayId: string,
    orderedIds: string[],
  ) => Promise<ActionResult>;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const BLOCK_TYPE_LABEL: Record<BlockType, string> = {
  warmup: "Warmup",
  strength: "Strength",
  conditioning: "Conditioning",
  mobility: "Mobility",
  other: "Other",
};

/* ════════════════════════════════════════════════════════════════════
   Sheet + field primitives (mirrors body/_components.tsx)
   ════════════════════════════════════════════════════════════════════ */

function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
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
  );
}

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
   The editor root
   ════════════════════════════════════════════════════════════════════ */

export function DayEditor(props: DayEditorProps) {
  const { day, readOnly } = props;
  return (
    <>
      <div className="relative z-10 mb-1 px-0.5">
        <h1 className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.03em] text-text">
          {day.title}
        </h1>
        <div className="mt-1 font-cond text-[11px] uppercase tracking-[0.12em] text-muted">
          Phase {day.phase} · Week {day.week} · Day {day.day}
          {readOnly ? " · read-only" : ""}
        </div>
      </div>

      {!readOnly ? <DayFields {...props} /> : <ReadOnlyDayNote day={day} />}

      <SectionHeader>Blocks</SectionHeader>
      <BlocksSection {...props} />
    </>
  );
}

function ReadOnlyDayNote({ day }: { day: DayData }) {
  // This renders a PUBLIC program's day for any signed-in viewer (cross-user),
  // so re-validate before using video_url as an href. Without this a poisoned
  // value (e.g. a javascript: URL written directly via PostgREST before the
  // 0007 DB CHECK is applied) would be stored XSS against every viewer. Only an
  // https://mtntough.com link survives; anything else shows "No video linked".
  const safeVideoUrl = validateVideoUrl(day.video_url);
  return (
    <Card className="mb-1 mt-2 p-4">
      <div className="space-y-1.5 text-[13px] text-muted">
        {day.est_minutes ? <div>~{day.est_minutes} min</div> : null}
        {safeVideoUrl ? (
          <a
            href={safeVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-gold underline-offset-2 hover:underline"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch on MTNTOUGH
          </a>
        ) : (
          <div className="text-faint">No video linked.</div>
        )}
      </div>
      <p className="mt-3 text-xs text-faint">
        This is a read-only template. Copy the program to edit it.
      </p>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Day fields (inline form, no sheet — it's the page's primary content)
   ════════════════════════════════════════════════════════════════════ */

function DayFields({ programId, day, updateDayAction }: DayEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    if (!title) {
      setError("Title is required.");
      return;
    }
    const input = {
      title,
      phase: Number(fd.get("phase")) || 1,
      week: Number(fd.get("week")) || 1,
      day: Number(fd.get("day")) || 1,
      estMinutes: numOrNull(fd.get("est_minutes")),
      videoUrl: String(fd.get("video_url") ?? "").trim() || null,
    };
    startTransition(async () => {
      const res = await updateDayAction(day.id, programId, input);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="mb-1 mt-2 p-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Title">
          <input
            name="title"
            type="text"
            defaultValue={day.title}
            className={inputCls}
            placeholder="Session title"
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
                defaultValue={day.phase}
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
                defaultValue={day.week}
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
                defaultValue={day.day}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <Field label="Est. minutes" suffix="min">
          <input
            name="est_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={day.est_minutes ?? ""}
            placeholder="—"
            className={inputCls}
          />
        </Field>
        <Field label="MTNTOUGH video URL">
          <input
            name="video_url"
            type="url"
            inputMode="url"
            defaultValue={day.video_url ?? ""}
            placeholder="https://mtntough.com/…"
            className={inputCls}
          />
        </Field>
        <ErrorNote message={error} />
        {saved && !error ? (
          <p className="font-cond text-xs font-semibold uppercase tracking-wide text-accent2">
            Saved.
          </p>
        ) : null}
        <SubmitBtn pending={pending}>Save Day</SubmitBtn>
      </form>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Blocks section (list + add) — drag to reorder blocks
   ════════════════════════════════════════════════════════════════════ */

function BlocksSection(props: DayEditorProps) {
  const {
    programId,
    readOnly,
    day,
    blocks,
    blockTypes,
    createBlockAction,
    reorderBlocksAction,
  } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Add-block sheet
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Local order for drag
  const [order, setOrder] = useState<BlockData[]>(blocks);
  useEffect(() => setOrder(blocks), [blocks]);
  const [dragId, setDragId] = useState<string | null>(null);

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddError(null);
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get("label") ?? "").trim();
    if (!label) {
      setAddError("Label is required.");
      return;
    }
    const input = {
      label,
      type: String(fd.get("type") ?? "strength") as BlockType,
      detail: String(fd.get("detail") ?? "").trim() || null,
    };
    startTransition(async () => {
      const res = await createBlockAction(day.id, programId, input);
      if (!res.ok) {
        setAddError(res.error ?? "Could not add block.");
        return;
      }
      setAddOpen(false);
      router.refresh();
    });
  }

  function onDropBlock(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = order.findIndex((b) => b.id === dragId);
    const to = order.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    setDragId(null);
    startTransition(async () => {
      await reorderBlocksAction(programId, day.id, next.map((b) => b.id));
      router.refresh();
    });
  }

  if (order.length === 0) {
    return (
      <>
        <Card className="p-6 text-center">
          <p className="mb-3 text-[13px] text-muted">
            {readOnly
              ? "This day has no blocks."
              : "No blocks yet. Add a warmup, strength, or conditioning block, then list its exercises."}
          </p>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-[16px] bg-grad px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-bg"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add block
            </button>
          ) : null}
        </Card>
        <AddBlockSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSubmit={onAdd}
          error={addError}
          pending={pending}
          blockTypes={blockTypes}
        />
      </>
    );
  }

  return (
    <div className="space-y-2.5">
      {order.map((b) => (
        <BlockCard
          key={b.id}
          block={b}
          props={props}
          draggable={!readOnly && order.length > 1}
          dragging={dragId === b.id}
          onDragStart={() => setDragId(b.id)}
          onDropBlock={() => onDropBlock(b.id)}
        />
      ))}

      {!readOnly ? (
        <button
          type="button"
          onClick={() => {
            setAddError(null);
            setAddOpen(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-solid bg-surface px-4 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add block
        </button>
      ) : null}

      <AddBlockSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={onAdd}
        error={addError}
        pending={pending}
        blockTypes={blockTypes}
      />
    </div>
  );
}

function AddBlockSheet({
  open,
  onClose,
  onSubmit,
  error,
  pending,
  blockTypes,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  error: string | null;
  pending: boolean;
  blockTypes: ReadonlyArray<BlockType>;
}) {
  return (
    <Sheet open={open} title="Add Block" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Label">
          <input
            name="label"
            type="text"
            placeholder="e.g. Main Strength"
            className={inputCls}
            autoFocus
          />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue="strength" className={cx(inputCls, "appearance-none")}>
            {blockTypes.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Detail / note">
          <input
            name="detail"
            type="text"
            placeholder="e.g. Superset · EMOM 12"
            className={inputCls}
          />
        </Field>
        <ErrorNote message={error} />
        <SubmitBtn pending={pending}>Add Block</SubmitBtn>
      </form>
    </Sheet>
  );
}

/* ════════════════════════════════════════════════════════════════════
   One block card: edit/delete the block + its exercise rows
   ════════════════════════════════════════════════════════════════════ */

function BlockCard({
  block,
  props,
  draggable,
  dragging,
  onDragStart,
  onDropBlock,
}: {
  block: BlockData;
  props: DayEditorProps;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDropBlock: () => void;
}) {
  const {
    programId,
    readOnly,
    day,
    blockTypes,
    library,
    updateBlockAction,
    deleteBlockAction,
    createExerciseRowAction,
    updateExerciseRowAction,
    deleteExerciseRowAction,
    reorderExerciseRowsAction,
  } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Exercise-row sheet (create or edit)
  const [rowSheet, setRowSheet] = useState<{ mode: "new" } | { mode: "edit"; row: ExerciseRowData } | null>(
    null,
  );

  // Local order of rows for drag
  const [rows, setRows] = useState<ExerciseRowData[]>(block.rows);
  useEffect(() => setRows(block.rows), [block.rows]);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  function onEditBlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditError(null);
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get("label") ?? "").trim();
    if (!label) {
      setEditError("Label is required.");
      return;
    }
    const input = {
      label,
      type: String(fd.get("type") ?? "strength") as BlockType,
      detail: String(fd.get("detail") ?? "").trim() || null,
    };
    startTransition(async () => {
      const res = await updateBlockAction(block.id, programId, day.id, input);
      if (!res.ok) {
        setEditError(res.error ?? "Could not save.");
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function removeBlock() {
    if (!window.confirm(`Delete block "${block.label}" and its exercises?`)) return;
    startTransition(async () => {
      await deleteBlockAction(block.id, programId, day.id);
      router.refresh();
    });
  }

  function removeRow(rowId: string) {
    startTransition(async () => {
      await deleteExerciseRowAction(rowId, programId, day.id);
      router.refresh();
    });
  }

  function onDropRow(targetId: string) {
    if (!dragRowId || dragRowId === targetId) {
      setDragRowId(null);
      return;
    }
    const from = rows.findIndex((r) => r.id === dragRowId);
    const to = rows.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) {
      setDragRowId(null);
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRows(next);
    setDragRowId(null);
    startTransition(async () => {
      await reorderExerciseRowsAction(programId, day.id, next.map((r) => r.id));
      router.refresh();
    });
  }

  function submitRow(input: ExerciseRowInput) {
    return new Promise<ActionResult>((resolve) => {
      startTransition(async () => {
        const res =
          rowSheet && rowSheet.mode === "edit"
            ? await updateExerciseRowAction(rowSheet.row.id, programId, day.id, input)
            : await createExerciseRowAction(block.id, programId, day.id, input);
        if (res.ok) {
          setRowSheet(null);
          router.refresh();
        }
        resolve({ ok: res.ok, error: res.error });
      });
    });
  }

  return (
    <Card
      className={cx("p-3.5", dragging && "opacity-50")}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDropBlock();
      }}
    >
      {/* Block header */}
      <div className="flex items-center gap-2.5">
        {draggable ? (
          <span aria-hidden className="flex-shrink-0 cursor-grab text-faint" title="Drag to reorder">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:2]">
              <circle cx="9" cy="6" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="18" r="1" />
              <circle cx="15" cy="6" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="18" r="1" />
            </svg>
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-sm font-semibold uppercase tracking-[0.03em] text-text">
              {block.label}
            </span>
            <span className="flex-shrink-0 rounded-full border border-line bg-surface2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-gold">
              {BLOCK_TYPE_LABEL[block.type]}
            </span>
          </div>
          {block.detail ? (
            <div className="mt-0.5 truncate text-xs text-muted">{block.detail}</div>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditError(null);
                setEditOpen(true);
              }}
              aria-label="Edit block"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface2 text-muted"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={removeBlock}
              disabled={pending}
              aria-label="Delete block"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface2 text-danger disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* Exercise rows */}
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="px-1 text-xs text-faint">
            {readOnly ? "No exercises." : "No exercises in this block yet."}
          </p>
        ) : (
          rows.map((r) => (
            <ExerciseRowItem
              key={r.id}
              row={r}
              readOnly={readOnly}
              draggable={!readOnly && rows.length > 1}
              dragging={dragRowId === r.id}
              onDragStart={() => setDragRowId(r.id)}
              onDropRow={() => onDropRow(r.id)}
              onEdit={() => setRowSheet({ mode: "edit", row: r })}
              onDelete={() => removeRow(r.id)}
              pending={pending}
            />
          ))
        )}
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => setRowSheet({ mode: "new" })}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line-solid bg-surface px-3 py-2.5 font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add exercise
        </button>
      ) : null}

      {/* Block edit sheet */}
      <Sheet open={editOpen} title="Edit Block" onClose={() => setEditOpen(false)}>
        <form onSubmit={onEditBlock} className="space-y-4">
          <Field label="Label">
            <input name="label" type="text" defaultValue={block.label} className={inputCls} autoFocus />
          </Field>
          <Field label="Type">
            <select name="type" defaultValue={block.type} className={cx(inputCls, "appearance-none")}>
              {blockTypes.map((t) => (
                <option key={t} value={t}>
                  {BLOCK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Detail / note">
            <input name="detail" type="text" defaultValue={block.detail ?? ""} className={inputCls} />
          </Field>
          <ErrorNote message={editError} />
          <SubmitBtn pending={pending}>Save Block</SubmitBtn>
        </form>
      </Sheet>

      {/* Exercise-row sheet */}
      {rowSheet ? (
        <ExerciseRowSheet
          key={rowSheet.mode === "edit" ? rowSheet.row.id : "new"}
          mode={rowSheet.mode}
          row={rowSheet.mode === "edit" ? rowSheet.row : null}
          library={library}
          onClose={() => setRowSheet(null)}
          onSubmit={submitRow}
          pending={pending}
        />
      ) : null}
    </Card>
  );
}

/* ── one exercise row (display) ──────────────────────────────────────── */

function ExerciseRowItem({
  row,
  readOnly,
  draggable,
  dragging,
  onDragStart,
  onDropRow,
  onEdit,
  onDelete,
  pending,
}: {
  row: ExerciseRowData;
  readOnly: boolean;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDropRow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const meta = [
    row.sets != null ? `${row.sets} ×` : null,
    row.reps,
    row.load,
    row.distance,
    row.time,
    row.rest ? `rest ${row.rest}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-[12px] border border-line bg-surface2 px-3 py-2.5",
        dragging && "opacity-50",
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDropRow();
      }}
    >
      {draggable ? (
        <span aria-hidden className="flex-shrink-0 cursor-grab text-faint" title="Drag to reorder">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2]">
            <circle cx="9" cy="6" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="18" r="1" />
            <circle cx="15" cy="6" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="18" r="1" />
          </svg>
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-display text-[13px] font-semibold text-text">
            {row.name}
          </span>
          {row.exercise_id ? (
            <span
              aria-label="From library"
              title="Linked to your exercise library"
              className="flex-shrink-0 text-gold"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21 8 14 2 9.6h7.6z" />
              </svg>
            </span>
          ) : null}
        </div>
        {meta ? <div className="mt-0.5 truncate text-xs text-muted">{meta}</div> : null}
        {row.notes ? <div className="mt-0.5 truncate text-xs text-faint">{row.notes}</div> : null}
      </div>
      {!readOnly ? (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${row.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-muted"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:1.9]">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={`Delete ${row.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-danger disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:1.9]">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── exercise-row create/edit sheet (with library picker) ────────────── */

function ExerciseRowSheet({
  mode,
  row,
  library,
  onClose,
  onSubmit,
  pending,
}: {
  mode: "new" | "edit";
  row: ExerciseRowData | null;
  library: LibraryExercise[];
  onClose: () => void;
  onSubmit: (input: ExerciseRowInput) => Promise<ActionResult>;
  pending: boolean;
}) {
  const [exerciseId, setExerciseId] = useState<string | null>(row?.exercise_id ?? null);
  const [name, setName] = useState<string>(row?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedLib = useMemo(
    () => library.find((l) => l.id === exerciseId) ?? null,
    [library, exerciseId],
  );

  const filteredLib = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter((l) => l.name.toLowerCase().includes(q));
  }, [library, search]);

  function pick(lib: LibraryExercise) {
    setExerciseId(lib.id);
    setName(lib.name);
    setPickerOpen(false);
  }

  function clearLink() {
    setExerciseId(null);
  }

  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Exercise name is required.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const input: ExerciseRowInput = {
      exerciseId,
      name: trimmed,
      sets: numOrNull(fd.get("sets")),
      reps: String(fd.get("reps") ?? "").trim() || null,
      load: String(fd.get("load") ?? "").trim() || null,
      distance: String(fd.get("distance") ?? "").trim() || null,
      time: String(fd.get("time") ?? "").trim() || null,
      rest: String(fd.get("rest") ?? "").trim() || null,
      notes: String(fd.get("notes") ?? "").trim() || null,
    };
    void onSubmit(input).then((res) => {
      if (!res.ok) setError(res.error ?? "Could not save.");
    });
  }

  return (
    <Sheet open title={mode === "edit" ? "Edit Exercise" : "Add Exercise"} onClose={onClose}>
      <form onSubmit={handle} className="space-y-4">
        {/* Library picker / custom name */}
        <div>
          <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
            Exercise
          </span>
          {library.length > 0 ? (
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPickerOpen((v) => !v);
                }}
                className="flex flex-1 items-center justify-between gap-2 rounded-[14px] border border-line bg-surface2 px-3.5 py-2.5 text-left font-display text-[13px] font-semibold uppercase tracking-wide text-text"
              >
                <span className="truncate">
                  {selectedLib ? selectedLib.name : "Pick from library"}
                </span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-none stroke-muted [stroke-width:2]">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {exerciseId ? (
                <button
                  type="button"
                  onClick={clearLink}
                  className="rounded-[14px] border border-line bg-surface2 px-3 py-2.5 font-cond text-[10px] font-semibold uppercase tracking-wide text-muted"
                >
                  Unlink
                </button>
              ) : null}
            </div>
          ) : null}

          {pickerOpen ? (
            <div className="mb-2 rounded-[14px] border border-line bg-bg2 p-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search library…"
                className="mb-2 w-full rounded-[10px] border border-line bg-surface2 px-3 py-2 font-display text-sm text-text outline-none placeholder:text-faint focus:border-accent"
              />
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {filteredLib.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-faint">No matches.</p>
                ) : (
                  filteredLib.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => pick(l)}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-sm",
                        l.id === exerciseId ? "bg-accent/[0.18] text-text" : "text-text hover:bg-surface2",
                      )}
                    >
                      <span className="truncate font-display">{l.name}</span>
                      <span className="flex-shrink-0 font-cond text-[10px] uppercase tracking-wide text-faint">
                        {BLOCK_TYPE_LABEL[l.category] ?? l.category}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // Editing the name detaches an auto-filled library link unless
              // it still matches exactly.
              if (selectedLib && e.target.value.trim() !== selectedLib.name) {
                setExerciseId(null);
              }
            }}
            placeholder="Or type a custom exercise name"
            className={inputCls}
          />
          {selectedLib ? (
            <p className="mt-1 font-cond text-[10px] uppercase tracking-wide text-gold">
              Linked to library
            </p>
          ) : null}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Sets">
              <input
                name="sets"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={row?.sets ?? ""}
                placeholder="—"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Reps">
              <input
                name="reps"
                type="text"
                defaultValue={row?.reps ?? ""}
                placeholder="8-12 / AMRAP"
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Load">
              <input
                name="load"
                type="text"
                defaultValue={row?.load ?? ""}
                placeholder="185 lb / RPE 8"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Rest">
              <input
                name="rest"
                type="text"
                defaultValue={row?.rest ?? ""}
                placeholder="90s"
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Distance">
              <input
                name="distance"
                type="text"
                defaultValue={row?.distance ?? ""}
                placeholder="3 mi"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Time">
              <input
                name="time"
                type="text"
                defaultValue={row?.time ?? ""}
                placeholder="8 min"
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <Field label="Notes">
          <input
            name="notes"
            type="text"
            defaultValue={row?.notes ?? ""}
            placeholder="Tempo, cues, scaling…"
            className={inputCls}
          />
        </Field>

        <ErrorNote message={error} />
        <SubmitBtn pending={pending}>
          {mode === "edit" ? "Save Exercise" : "Add Exercise"}
        </SubmitBtn>
      </form>
    </Sheet>
  );
}
