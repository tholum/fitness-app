"use client";

/* ════════════════════════════════════════════════════════════════════
   EXERCISE LIBRARY — client subcomponents (gap 3).
   A provider owns the open create/edit sheet; the searchable + filterable
   list and the "New Exercise" trigger call the server actions
   (createExercise / updateExercise / deleteExercise) passed in as props by
   the server page. Bottom-sheet + Field/SubmitBtn/ErrorNote pattern copied
   from src/app/(app)/body/_components.tsx. Styling is strictly theme-token
   Tailwind so it re-skins with the active theme/accent.
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
import { Card } from "@/components/ui";
import { Portal } from "@/components/Portal";
import { validateVideoUrl } from "@/lib/format";

/* ── shared shapes (kept local so the file is self-contained) ─────────── */
export type ExerciseCategory =
  | "warmup"
  | "strength"
  | "conditioning"
  | "mobility"
  | "other";

export interface ExerciseRow {
  id: string;
  owner_id: string | null;
  is_public: boolean;
  name: string;
  category: ExerciseCategory;
  default_video_url: string | null;
  cues: string | null;
}

export interface ExerciseInput {
  name: string;
  category: ExerciseCategory;
  defaultVideoUrl?: string | null;
  cues?: string | null;
  isPublic?: boolean;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Server-action signatures (passed in as props from the server page). */
export type CreateExerciseFn = (input: ExerciseInput) => Promise<ActionResult<{ id: string }>>;
export type UpdateExerciseFn = (id: string, input: ExerciseInput) => Promise<ActionResult>;
export type DeleteExerciseFn = (id: string) => Promise<ActionResult>;

const CATEGORIES: ReadonlyArray<{ value: ExerciseCategory; label: string }> = [
  { value: "warmup", label: "Warmup" },
  { value: "strength", label: "Strength" },
  { value: "conditioning", label: "Cond." },
  { value: "mobility", label: "Mobility" },
  { value: "other", label: "Other" },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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
   Provider — owns the create/edit sheet
   ════════════════════════════════════════════════════════════════════ */

interface ExercisesCtx {
  openNew: () => void;
  openEdit: (row: ExerciseRow) => void;
}

const Ctx = createContext<ExercisesCtx | null>(null);

function useExercises(): ExercisesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Must be used inside <ExercisesProvider>");
  return ctx;
}

export interface ExercisesProviderProps {
  createAction: CreateExerciseFn;
  updateAction: UpdateExerciseFn;
  deleteAction: DeleteExerciseFn;
  children: ReactNode;
}

export function ExercisesProvider({
  createAction,
  updateAction,
  deleteAction,
  children,
}: ExercisesProviderProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExerciseRow | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setError(null);
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (row: ExerciseRow) => {
    setError(null);
    setEditing(row);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setError(null);
  };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    const input: ExerciseInput = {
      name,
      category: String(fd.get("category") ?? "strength") as ExerciseCategory,
      defaultVideoUrl: String(fd.get("default_video_url") ?? "").trim() || null,
      cues: String(fd.get("cues") ?? "").trim() || null,
      isPublic: fd.get("is_public") === "on",
    };
    startTransition(async () => {
      const res = editing
        ? await updateAction(editing.id, input)
        : await createAction(input);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onDelete() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAction(editing.id);
      if (!res.ok) {
        setError(res.error ?? "Could not delete.");
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <Ctx.Provider value={{ openNew, openEdit }}>
      {children}

      <Sheet
        open={open}
        title={editing ? "Edit Exercise" : "New Exercise"}
        onClose={close}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <input
              name="name"
              type="text"
              defaultValue={editing?.name ?? ""}
              placeholder="e.g. Back Squat"
              className={inputCls}
              autoFocus
            />
          </Field>
          <Field label="Category">
            <select
              name="category"
              defaultValue={editing?.category ?? "strength"}
              className={cx(inputCls, "appearance-none")}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default video URL">
            <input
              name="default_video_url"
              type="url"
              inputMode="url"
              defaultValue={editing?.default_video_url ?? ""}
              placeholder="https://mtntough.com/…"
              className={inputCls}
            />
          </Field>
          <Field label="Cues / notes">
            <textarea
              name="cues"
              rows={3}
              defaultValue={editing?.cues ?? ""}
              placeholder="Coaching cues, tempo, setup…"
              className={cx(inputCls, "resize-none leading-snug")}
            />
          </Field>
          <label className="flex items-center justify-between rounded-[14px] border border-line bg-bg2 px-3.5 py-3">
            <span className="font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
              Share publicly
            </span>
            <input
              name="is_public"
              type="checkbox"
              defaultChecked={editing?.is_public ?? false}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>
            {editing ? "Save Exercise" : "Add Exercise"}
          </SubmitBtn>
          {editing ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="w-full rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-danger disabled:opacity-60"
            >
              Delete Exercise
            </button>
          ) : null}
        </form>
      </Sheet>
    </Ctx.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Triggers + list (rendered inline by the server page)
   ════════════════════════════════════════════════════════════════════ */

/** Header "+ New" pill → opens the create sheet. */
export function NewExerciseButton() {
  const { openNew } = useExercises();
  return (
    <button
      type="button"
      onClick={openNew}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text backdrop-blur-md"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New
    </button>
  );
}

const CAT_LABEL: Record<ExerciseCategory, string> = {
  warmup: "Warmup",
  strength: "Strength",
  conditioning: "Conditioning",
  mobility: "Mobility",
  other: "Other",
};

export function ExerciseList({
  exercises,
  myId,
}: {
  exercises: ExerciseRow[];
  myId: string | null;
}) {
  const { openEdit, openNew } = useExercises();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<ExerciseCategory | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exercises, query, cat]);

  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-muted [stroke-width:2]"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full rounded-[14px] border border-line bg-bg2 py-3 pl-10 pr-3.5 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent"
        />
      </div>

      {/* Category filter chips — single horizontally-scrollable row.
         no-scrollbar + overflow-x-auto + flex-nowrap keeps every category on
         one line and reachable at 390px; px-0.5 gives the first/last chip a
         little breathing room so they aren't flush-clipped at the edges. */}
      <div className="no-scrollbar -mx-0.5 mb-3.5 flex flex-nowrap gap-2 overflow-x-auto px-0.5 pb-0.5">
        <FilterChip active={cat === "all"} onClick={() => setCat("all")}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.value}
            active={cat === c.value}
            onClick={() => setCat(c.value)}
          >
            {c.label}
          </FilterChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center">
          {exercises.length === 0 ? (
            <>
              <p className="mb-3 text-[13px] text-muted">
                Your library is empty. Add movements here once and reuse them
                across every program day.
              </p>
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-2 rounded-[16px] bg-grad px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-bg"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-none stroke-current [stroke-width:2.4]"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add your first exercise
              </button>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              No exercises match your search.
            </p>
          )}
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((e) => {
            const mine = myId != null && e.owner_id === myId;
            // This list shows PUBLIC (cross-user) exercises, so re-validate
            // default_video_url before using it as an href. Without this a
            // poisoned value (e.g. a javascript: URL written directly via
            // PostgREST before the 0007 DB CHECK is applied, on an is_public
            // row) is stored XSS against every other user who opens the
            // library. Only an https://mtntough.com link survives.
            const safeVideoUrl = validateVideoUrl(e.default_video_url);
            return (
              <Card key={e.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.03em] text-text">
                      {e.name}
                    </span>
                    {!mine ? (
                      <span className="flex-shrink-0 rounded-full border border-line bg-surface2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-faint">
                        Public
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span className="font-cond uppercase tracking-wide text-gold">
                      {CAT_LABEL[e.category]}
                    </span>
                    {safeVideoUrl ? (
                      <a
                        href={safeVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="inline-flex items-center gap-1 text-muted underline-offset-2 hover:underline"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5 fill-current"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        Video
                      </a>
                    ) : null}
                  </div>
                  {e.cues ? (
                    <p className="mt-1 line-clamp-2 text-xs text-faint">{e.cues}</p>
                  ) : null}
                </div>
                {mine ? (
                  <button
                    type="button"
                    onClick={() => openEdit(e)}
                    aria-label={`Edit ${e.name}`}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface2 text-muted"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex-shrink-0 rounded-full border px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-transparent bg-grad text-bg"
          : "border-line bg-surface text-muted",
      )}
    >
      {children}
    </button>
  );
}
