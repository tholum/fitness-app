"use client";

/* ════════════════════════════════════════════════════════════════════
   ACCOUNT — client affordances (gaps 26,27).
   An editable profile card (display_name + avatar_url) that calls the
   updateProfile server action, plus a Sign Out control that POSTs to
   /auth/signout. Styling is strictly theme-token Tailwind (Card/Button
   tokens) so it re-skins with the active theme/accent, matching the
   BASECAMP look. Field / SubmitBtn / ErrorNote are re-implemented locally
   (mirrors body/_components.tsx) so this task stays self-contained.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import {
  updateProfile,
  logPR,
  updatePR,
  deletePR,
  deleteSession,
  uncompleteSession,
  updateSession,
} from "@/lib/actions";
import { todayISO } from "@/lib/format";

/* ── small local helpers (mirror body/_components.tsx) ────────────────── */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
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

/** Derive up-to-two initials for the avatar fallback monogram. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ════════════════════════════════════════════════════════════════════
   ProfileForm — editable display_name + avatar_url → updateProfile.
   Controlled name input drives the live avatar preview / monogram.
   ════════════════════════════════════════════════════════════════════ */

export interface ProfileFormProps {
  email: string | null;
  initialDisplayName: string;
  initialAvatarUrl: string | null;
}

export function ProfileForm({
  email,
  initialDisplayName,
  initialAvatarUrl,
}: ProfileFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(initialDisplayName);
  const [avatar, setAvatar] = useState(initialAvatarUrl ?? "");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Display name is required.");
      return;
    }

    startTransition(async () => {
      const res = await updateProfile({
        display_name: trimmed,
        avatar_url: avatar.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const preview = avatar.trim();

  return (
    <Card className="p-5">
      {/* Avatar preview + monogram fallback. */}
      <div className="mb-5 flex items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${name.trim() || "Your"} avatar`}
            className="h-[68px] w-[68px] flex-shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="flex h-[68px] w-[68px] flex-shrink-0 items-center justify-center rounded-full bg-grad font-display text-2xl font-bold text-bg shadow-[0_0_24px_rgba(200,98,45,.35)]">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-bold uppercase tracking-[0.03em] text-text">
            {name.trim() || "Your Name"}
          </div>
          {email ? (
            <div className="truncate text-xs text-muted">{email}</div>
          ) : null}
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Display name">
          <input
            name="display_name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. Trail Runner"
            className={inputCls}
          />
        </Field>
        <Field label="Avatar URL">
          <input
            name="avatar_url"
            type="url"
            inputMode="url"
            value={avatar}
            onChange={(e) => {
              setAvatar(e.target.value);
              setSaved(false);
            }}
            placeholder="https://…/avatar.jpg"
            className={inputCls}
          />
        </Field>
        <ErrorNote message={error} />
        {saved && !error ? (
          <p className="font-cond text-xs font-semibold uppercase tracking-wide text-accent2">
            Saved
          </p>
        ) : null}
        <SubmitBtn pending={pending}>Save Profile</SubmitBtn>
      </form>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SignOutButton — POSTs to /auth/signout (route clears the session and
   303-redirects to /login). A real <form> so it works without JS; the
   pending state is cosmetic.
   ════════════════════════════════════════════════════════════════════ */

export function SignOutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={() => startTransition(() => {})}
      className={cx("block", className)}
    >
      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-line bg-surface2 px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-danger disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px] fill-none stroke-current [stroke-width:2]"
          aria-hidden
        >
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        {pending ? "Signing out…" : "Sign Out"}
      </button>
    </form>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PROGRESS — Personal Records + Session History (gap 12).

   These are Progress-domain client components, but they live here because
   the build task's file allowlist only permits a single client-capable
   module for these tasks (account/_components.tsx) — progress/page.tsx is
   an async server component and can't define client components, and no
   progress/_components.tsx is allowed. progress/page.tsx imports these.

   Sheet / Field / SubmitBtn / ErrorNote are re-implemented locally
   (mirrors body/_components.tsx) so nothing edits the body files. The PR
   add/edit/delete flows call logPR / updatePR / deletePR; logPR also posts
   a kind='pr' feed item (handled in the action) so the crew 🏆 feed lights
   up. Optional session-history rows wire to uncompleteSession /
   deleteSession / updateSession.
   ════════════════════════════════════════════════════════════════════ */

/* ── shared row shapes (kept local so this file is self-contained) ─────── */
export interface PRRow {
  id: string;
  label: string;
  value: number;
  unit: string | null;
  achieved_on: string;
}

export interface SessionRow {
  id: string;
  title: string;
  date: string;
  rpe: number | null;
  duration_min: number | null;
  notes: string | null;
}

/** Parse a form input into a number, returning null for blank/invalid. */
function num(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Format an ISO date (YYYY-MM-DD) as e.g. "Jun 4, 2026" without TZ drift. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ── Sheet (mirrors body/_components.tsx; scrollable like exercises) ───── */
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

/* ════════════════════════════════════════════════════════════════════
   PR add/edit sheet form (shared by add + edit).
   ════════════════════════════════════════════════════════════════════ */
function PRForm({
  editing,
  onDone,
  onError,
}: {
  editing: PRRow | null;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fail(msg: string) {
    setError(msg);
    onError(msg);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    onError(null);
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get("label") ?? "").trim();
    const value = num(fd.get("value"));
    const unit = String(fd.get("unit") ?? "").trim() || null;
    const achievedOn = String(fd.get("achieved_on") ?? "").trim() || todayISO();

    if (!label) {
      fail("Give the record a label.");
      return;
    }
    if (value == null) {
      fail("Enter a numeric value.");
      return;
    }

    startTransition(async () => {
      const res = editing
        ? await updatePR(editing.id, {
            label,
            value,
            unit,
            achievedOn,
          })
        : await logPR({ label, value, unit, achievedOn });
      if (!res.ok) {
        fail(res.error ?? "Could not save.");
        return;
      }
      onDone();
      router.refresh();
    });
  }

  function onDelete() {
    if (!editing) return;
    setError(null);
    onError(null);
    startTransition(async () => {
      const res = await deletePR(editing.id);
      if (!res.ok) {
        fail(res.error ?? "Could not delete.");
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Record">
        <input
          name="label"
          type="text"
          defaultValue={editing?.label ?? ""}
          placeholder="e.g. Back Squat 1RM"
          className={inputCls}
          autoFocus
        />
      </Field>
      <div className="flex gap-3">
        <div className="flex-[2]">
          <Field label="Value">
            <input
              name="value"
              type="number"
              inputMode="decimal"
              step="any"
              defaultValue={editing?.value ?? ""}
              placeholder="0"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Unit">
            <input
              name="unit"
              type="text"
              defaultValue={editing?.unit ?? ""}
              placeholder="lb"
              className={inputCls}
            />
          </Field>
        </div>
      </div>
      <Field label="Achieved on">
        <input
          name="achieved_on"
          type="date"
          defaultValue={editing?.achieved_on ?? todayISO()}
          className={inputCls}
        />
      </Field>
      <ErrorNote message={error} />
      <SubmitBtn pending={pending}>
        {editing ? "Save Record" : "Add Record"}
      </SubmitBtn>
      {editing ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="w-full rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-danger disabled:opacity-60"
        >
          Delete Record
        </button>
      ) : null}
    </form>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Session-history edit sheet (rpe / duration / notes → updateSession;
   uncomplete + delete via uncompleteSession / deleteSession).
   ════════════════════════════════════════════════════════════════════ */
function SessionForm({
  editing,
  onDone,
  onError,
}: {
  editing: SessionRow;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fail(msg: string) {
    setError(msg);
    onError(msg);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    onError(null);
    const fd = new FormData(e.currentTarget);
    const rpe = num(fd.get("rpe"));
    const durationMin = num(fd.get("duration_min"));
    const notes = String(fd.get("notes") ?? "").trim() || null;

    startTransition(async () => {
      const res = await updateSession(editing.id, { rpe, durationMin, notes });
      if (!res.ok) {
        fail(res.error ?? "Could not save.");
        return;
      }
      onDone();
      router.refresh();
    });
  }

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    failMsg: string,
  ) {
    setError(null);
    onError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        fail(res.error ?? failMsg);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <Field label="RPE">
            <input
              name="rpe"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="1"
              max="10"
              defaultValue={editing.rpe ?? ""}
              placeholder="0–10"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Duration (min)">
            <input
              name="duration_min"
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              defaultValue={editing.duration_min ?? ""}
              placeholder="0"
              className={inputCls}
            />
          </Field>
        </div>
      </div>
      <Field label="Notes">
        <textarea
          name="notes"
          rows={3}
          defaultValue={editing.notes ?? ""}
          placeholder="How did it feel?"
          className={cx(inputCls, "resize-none leading-snug")}
        />
      </Field>
      <ErrorNote message={error} />
      <SubmitBtn pending={pending}>Save Session</SubmitBtn>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() =>
            run(() => uncompleteSession(editing.id), "Could not update.")
          }
          disabled={pending}
          className="flex-1 rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-muted disabled:opacity-60"
        >
          Mark Undone
        </button>
        <button
          type="button"
          onClick={() => run(() => deleteSession(editing.id), "Could not delete.")}
          disabled={pending}
          className="flex-1 rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-danger disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </form>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ProgressRecords — the Personal Records list + Add/Edit sheet, with an
   optional session-history list. Rendered by progress/page.tsx with the
   server-fetched rows. Owns all sheet state.
   ════════════════════════════════════════════════════════════════════ */
export interface ProgressRecordsProps {
  prs: PRRow[];
  sessions: SessionRow[];
}

export function ProgressRecords({ prs, sessions }: ProgressRecordsProps) {
  // null sheet = closed; "new" = add PR; PRRow = edit PR; SessionRow = edit session.
  const [sheet, setSheet] = useState<"new" | PRRow | SessionRow | null>(null);
  // Lifted error is reset whenever a sheet opens/closes.
  const [, setSheetError] = useState<string | null>(null);

  const openNew = () => {
    setSheetError(null);
    setSheet("new");
  };
  const openPR = (row: PRRow) => {
    setSheetError(null);
    setSheet(row);
  };
  const openSession = (row: SessionRow) => {
    setSheetError(null);
    setSheet(row);
  };
  const close = () => {
    setSheetError(null);
    setSheet(null);
  };

  const editingPR =
    sheet && sheet !== "new" && "value" in sheet ? (sheet as PRRow) : null;
  const editingSession =
    sheet && sheet !== "new" && "title" in sheet ? (sheet as SessionRow) : null;

  return (
    <>
      {/* ── Personal Records section header + Add ── */}
      <SectionHeaderLocal
        action={
          <button
            type="button"
            onClick={openNew}
            className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold"
          >
            + Add PR
          </button>
        }
      >
        Personal Records
      </SectionHeaderLocal>

      {prs.length ? (
        <div className="space-y-2.5">
          {prs.map((pr) => (
            <Card key={pr.id} className="flex items-center gap-[13px] p-3.5">
              <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px] border border-line bg-surface2 text-lg">
                🏆
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
                  {pr.label}
                </div>
                <div className="text-xs text-muted">{fmtDate(pr.achieved_on)}</div>
              </div>
              <div className="flex-shrink-0 text-right font-display text-base font-bold text-text">
                {pr.value}
                {pr.unit ? (
                  <span className="ml-1 font-cond text-xs uppercase text-muted">
                    {pr.unit}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => openPR(pr)}
                aria-label={`Edit ${pr.label}`}
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
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-5 text-center">
          <p className="mb-3 text-[13px] text-muted">
            No personal records yet. Log a PR to celebrate it — your crew sees a
            🏆 in the feed.
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
            Add your first PR
          </button>
        </Card>
      )}

      {/* ── Optional recent session history ── */}
      {sessions.length ? (
        <>
          <SectionHeaderLocal>Recent Sessions</SectionHeaderLocal>
          <div className="space-y-2.5">
            {sessions.map((s) => (
              <Card key={s.id} className="flex items-center gap-[13px] p-3.5">
                <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px] border border-line bg-surface2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.9]">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
                    {s.title}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {fmtDate(s.date)}
                    {s.duration_min != null ? ` · ${s.duration_min} min` : ""}
                    {s.rpe != null ? ` · RPE ${s.rpe}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openSession(s)}
                  aria-label={`Edit ${s.title}`}
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
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* ── Add / Edit PR sheet ── */}
      <Sheet
        open={sheet === "new" || editingPR != null}
        title={editingPR ? "Edit Record" : "Add Personal Record"}
        onClose={close}
      >
        {/* key forces a fresh form (resets defaults) per target. */}
        <PRForm
          key={editingPR ? editingPR.id : "new"}
          editing={editingPR}
          onDone={close}
          onError={setSheetError}
        />
      </Sheet>

      {/* ── Edit session sheet ── */}
      <Sheet
        open={editingSession != null}
        title="Edit Session"
        onClose={close}
      >
        {editingSession ? (
          <SessionForm
            key={editingSession.id}
            editing={editingSession}
            onDone={close}
            onError={setSheetError}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/* Local SectionHeader clone so this client module doesn't depend on the
   server SectionHeader's exact action styling (keeps parity with the
   prototype's gold action links used elsewhere). */
function SectionHeaderLocal({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-1 mb-3 mt-5 flex items-center justify-between font-display text-base font-semibold uppercase tracking-[0.094em] text-text">
      <span>{children}</span>
      {action ? <span>{action}</span> : null}
    </div>
  );
}
