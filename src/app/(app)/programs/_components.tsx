"use client";

/* ════════════════════════════════════════════════════════════════════
   PROGRAMS — client subcomponents (gaps 6, 9).
   A provider owns the "New Program" sheet + shared pending/error state and
   exposes create / delete / enroll / clone via context (server actions are
   passed in as props). The tabbed view renders My Programs (Edit / Delete +
   active badge) and Templates / Public (Enroll + "Make a copy I can edit").
   Bottom-sheet + Field/SubmitBtn/ErrorNote pattern copied from
   src/app/(app)/body/_components.tsx; primitives from src/components/ui.tsx.
   ════════════════════════════════════════════════════════════════════ */

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Segmented, SubmitBtn, ErrorNote } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { cx } from "@/lib/cx";
import { useConfirm } from "@/components/Confirm";

/* ── shared shapes (kept local so the file is self-contained) ─────────── */
export interface ProgramCard {
  id: string;
  name: string;
  source: string;
  owner_id: string | null;
  is_public: boolean;
  created_at: string;
  dayCount?: number;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export type CreateProgramFn = (name: string) => Promise<ActionResult<{ id: string }>>;
export type DeleteProgramFn = (id: string) => Promise<ActionResult>;
export type EnrollFn = (programId: string) => Promise<ActionResult>;
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

interface ProgramsCtx {
  openNew: () => void;
  enroll: (id: string) => void;
  clone: (id: string) => void;
  remove: (id: string, name: string) => void;
  pending: boolean;
  busyId: string | null;
}

const Ctx = createContext<ProgramsCtx | null>(null);

function usePrograms(): ProgramsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Must be used inside <ProgramsProvider>");
  return ctx;
}

export interface ProgramsProviderProps {
  createAction: CreateProgramFn;
  deleteAction: DeleteProgramFn;
  enrollAction: EnrollFn;
  cloneAction: CloneFn;
  children: ReactNode;
}

export function ProgramsProvider({
  createAction,
  deleteAction,
  enrollAction,
  cloneAction,
  children,
}: ProgramsProviderProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openNew = () => {
    setError(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setError(null);
  };

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await createAction(name);
      if (!res.ok || !res.data) {
        setError(res.error ?? "Could not create.");
        return;
      }
      close();
      router.push(`/programs/${res.data.id}`);
    });
  }

  function enroll(id: string) {
    setBusyId(id);
    startTransition(async () => {
      await enrollAction(id);
      setBusyId(null);
      router.refresh();
    });
  }

  function clone(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await cloneAction(id);
      setBusyId(null);
      if (res.ok && res.data) {
        router.push(`/programs/${res.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  function remove(id: string, name: string) {
    void confirm({
      title: "Delete program?",
      message: `Delete "${name}"? This removes all its days and blocks.`,
      confirmLabel: "Delete",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setBusyId(id);
      startTransition(async () => {
        await deleteAction(id);
        setBusyId(null);
        router.refresh();
      });
    });
  }

  return (
    <Ctx.Provider value={{ openNew, enroll, clone, remove, pending, busyId }}>
      {children}

      <Sheet open={open} title="New Program" onClose={close}>
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Program name">
            <input
              name="name"
              type="text"
              placeholder="e.g. Backcountry Strength — Spring"
              className={inputCls}
              autoFocus
            />
          </Field>
          <p className="text-xs text-muted">
            You&apos;ll add phases, weeks, days, and exercises next.
          </p>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>Create Program</SubmitBtn>
        </form>
      </Sheet>
    </Ctx.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Triggers + tabbed view
   ════════════════════════════════════════════════════════════════════ */

export function NewProgramButton() {
  const { openNew } = usePrograms();
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

type Tab = "mine" | "templates";

export function ProgramsView({
  mine,
  templates,
  activeProgramId,
}: {
  mine: ProgramCard[];
  templates: ProgramCard[];
  activeProgramId: string | null;
}) {
  const { openNew } = usePrograms();
  const [tab, setTab] = useState<Tab>(mine.length === 0 && templates.length > 0 ? "templates" : "mine");

  return (
    <div>
      <Segmented<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: `My Programs${mine.length ? ` (${mine.length})` : ""}` },
          { value: "templates", label: "Templates" },
        ]}
      />

      {tab === "mine" ? (
        mine.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="mb-3 text-[13px] text-muted">
              You haven&apos;t created a program yet. Start from scratch, copy a
              template, or import a plan.
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
              New Program
            </button>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {mine.map((p) => (
              <MyProgramCard
                key={p.id}
                program={p}
                active={p.id === activeProgramId}
              />
            ))}
          </div>
        )
      ) : templates.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-[13px] text-muted">
            No public templates available yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {templates.map((p) => (
            <TemplateCard
              key={p.id}
              program={p}
              enrolled={p.id === activeProgramId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source !== "MTNTOUGH") return null;
  return (
    <span className="flex-shrink-0 rounded-full border border-line bg-surface2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-gold">
      MTNTOUGH
    </span>
  );
}

function meta(p: ProgramCard): string {
  const parts: string[] = [];
  const n = p.dayCount ?? 0;
  parts.push(`${n} ${n === 1 ? "day" : "days"}`);
  if (p.source && p.source !== "MTNTOUGH" && p.source !== "custom") parts.push(p.source);
  return parts.join(" · ");
}

function MyProgramCard({
  program,
  active,
}: {
  program: ProgramCard;
  active: boolean;
}) {
  const { remove, busyId, pending } = usePrograms();
  const busy = pending && busyId === program.id;

  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-3">
        <Link href={`/programs/${program.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.03em] text-text">
              {program.name}
            </span>
            <SourceBadge source={program.source} />
            {active ? (
              <span className="flex-shrink-0 rounded-full bg-accent2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-bg">
                Active
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-muted">{meta(program)}</div>
        </Link>
        <span className="mt-1 font-display text-gold">›</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Link
          href={`/programs/${program.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-line bg-surface2 px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-text"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
          </svg>
          Edit
        </Link>
        <button
          type="button"
          onClick={() => remove(program.id, program.name)}
          disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded-[12px] border border-line bg-surface2 px-3.5 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-danger disabled:opacity-60"
        >
          {busy ? "…" : "Delete"}
        </button>
      </div>
    </Card>
  );
}

function TemplateCard({
  program,
  enrolled,
}: {
  program: ProgramCard;
  enrolled: boolean;
}) {
  const { enroll, clone, busyId, pending } = usePrograms();
  const busy = pending && busyId === program.id;

  return (
    <Card className="p-3.5">
      <Link href={`/programs/${program.id}`} className="block">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.03em] text-text">
            {program.name}
          </span>
          <SourceBadge source={program.source} />
          {enrolled ? (
            <span className="flex-shrink-0 rounded-full bg-accent2 px-2 py-0.5 font-cond text-[9px] font-semibold uppercase tracking-wide text-bg">
              Active
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-muted">{meta(program)}</div>
      </Link>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => enroll(program.id)}
          disabled={busy || enrolled}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-grad px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-bg disabled:opacity-60"
        >
          {enrolled ? "Enrolled" : busy ? "…" : "Enroll"}
        </button>
        <button
          type="button"
          onClick={() => clone(program.id)}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-line bg-surface2 px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-text disabled:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 012-2h10" />
          </svg>
          {busy ? "…" : "Copy & edit"}
        </button>
      </div>
    </Card>
  );
}
