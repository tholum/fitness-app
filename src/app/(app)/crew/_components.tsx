"use client";

/* ════════════════════════════════════════════════════════════════════
   CREW — client subcomponents
   ─────────────────────────────────────────────────────────────────────
   Interactive pieces for the cooperative Crew screen:
     • Reactions       — reaction chips (👊 🔥 💬) on feed posts
     • NudgeButton     — supportive "nudge" next to a crew-mate
     • InviteCode      — invite-code share affordance (tap to copy)
     • CrewOnboarding  — two-choice empty state (create / join by code)
     • CrewSwitcher    — header dropdown to switch the active crew
     • CrewMenu        — overflow/settings menu (join another / leave /
                          edit / per-member remove)
     • NoteComposer    — small encouragement composer atop the feed

   The Sheet/Field/SubmitBtn pattern mirrors body/_components.tsx. Server
   data is read in page.tsx; these own the mutations and revalidate via
   each action's revalidatePath plus a router.refresh() where the active
   crew or roster changes. All styling is theme-token Tailwind so it
   re-skins with the active theme/accent.
   ════════════════════════════════════════════════════════════════════ */

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  react,
  nudge,
  createCrew,
  joinCrew,
  leaveCrew,
  editCrew,
  removeMember,
  setActiveCrew,
  postNote,
} from "@/lib/actions";
import type { Crew } from "@/lib/types";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Parse a form input into a finite number, returning null for blank/invalid. */
function num(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ── Shared form primitives (mirrors body/_components.tsx) ────────────── */

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

function SubmitBtn({
  pending,
  children,
  pendingLabel = "Saving…",
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
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

/* ── Reactions ─────────────────────────────────────────────────────────
   Cooperative reaction chips (👊 🔥 💬). Each chip is a toggle: tapping
   adds/removes the current user's reaction via the `react` server action.
   Counts update optimistically; the action's revalidatePath reconciles. */

const REACTION_EMOJIS = ["👊", "🔥", "💬"] as const;

interface ReactionState {
  count: number;
  mine: boolean;
}

export interface ReactionsProps {
  postId: string;
  /** Initial per-emoji state derived server-side from the post's reactions. */
  initial: Record<string, ReactionState>;
}

export function Reactions({ postId, initial }: ReactionsProps) {
  const [state, setState] = useState<Record<string, ReactionState>>(() => {
    const seeded: Record<string, ReactionState> = {};
    for (const emoji of REACTION_EMOJIS) {
      seeded[emoji] = initial[emoji] ?? { count: 0, mine: false };
    }
    return seeded;
  });
  const [pending, startTransition] = useTransition();

  function toggle(emoji: string) {
    // Optimistic flip.
    setState((prev) => {
      const cur = prev[emoji] ?? { count: 0, mine: false };
      const mine = !cur.mine;
      return {
        ...prev,
        [emoji]: { mine, count: Math.max(0, cur.count + (mine ? 1 : -1)) },
      };
    });
    startTransition(async () => {
      const res = await react(postId, emoji);
      if (!res.ok) {
        // Revert on failure.
        setState((prev) => {
          const cur = prev[emoji] ?? { count: 0, mine: false };
          const mine = !cur.mine;
          return {
            ...prev,
            [emoji]: { mine, count: Math.max(0, cur.count + (mine ? 1 : -1)) },
          };
        });
      }
    });
  }

  return (
    <div className="mt-3 flex gap-2">
      {REACTION_EMOJIS.map((emoji) => {
        const s = state[emoji];
        return (
          <button
            key={emoji}
            type="button"
            disabled={pending}
            onClick={() => toggle(emoji)}
            aria-pressed={s.mine}
            className={cx(
              "flex items-center gap-1.5 rounded-[20px] border px-[11px] py-[5px] font-display text-[13px] font-semibold transition-colors disabled:opacity-70",
              s.mine
                ? "border-accent bg-accent/[0.18] text-text"
                : "border-line bg-surface2 text-text",
            )}
          >
            {emoji}
            {s.count > 0 ? <span className="text-xs text-muted">{s.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── NudgeButton ───────────────────────────────────────────────────────
   Supportive prompt shown next to a crew-mate who hasn't trained today.
   Fires the `nudge` server action once; settles into a "Nudged" state. */

export interface NudgeButtonProps {
  toUser: string;
  crewId?: string | null;
  className?: string;
}

export function NudgeButton({ toUser, crewId, className }: NudgeButtonProps) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function send() {
    if (sent || pending) return;
    startTransition(async () => {
      const res = await nudge(toUser, crewId ?? null);
      if (res.ok) setSent(true);
    });
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={sent || pending}
      className={cx(
        "flex-shrink-0 rounded-xl border-none px-3.5 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-bg disabled:opacity-80",
        sent ? "bg-accent2" : "bg-grad2",
        className,
      )}
    >
      {sent ? "✓ Nudged" : pending ? "…" : "👊 Nudge"}
    </button>
  );
}

/* ── InviteCode ────────────────────────────────────────────────────────
   Shows the crew's invite_code with a tap-to-copy affordance. Falls back
   gracefully if the clipboard API is unavailable. */

export interface InviteCodeProps {
  code: string;
}

export function InviteCode({ code }: InviteCodeProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (e.g. insecure context) — leave the code visible.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-center justify-between gap-3 rounded-card border border-dashed border-line-solid bg-surface p-4 text-left transition-colors hover:bg-surface2"
    >
      <div className="min-w-0">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-text">
          Invite crew
        </div>
        <div className="mt-0.5 text-xs text-muted">
          Share this code so others can join your crew.
        </div>
      </div>
      <span className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-surface2 px-3 py-2 font-display text-base font-bold uppercase tracking-[0.15em] text-gold">
        {code}
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-4 w-4 fill-none stroke-muted [stroke-width:1.8]"
        >
          {copied ? (
            <path d="M5 13l4 4L19 7" />
          ) : (
            <>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 012-2h10" />
            </>
          )}
        </svg>
      </span>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
   CrewOnboarding — empty-state, two-choice onboarding
   ─────────────────────────────────────────────────────────────────────
   Replaces the static "No crew yet" copy. A "Create a crew" form
   (name + weekly goal → createCrew) and a "Join with code" input
   (→ joinCrew). On success the action sets the new crew active; we
   router.refresh() so the page re-renders with the crew.
   ════════════════════════════════════════════════════════════════════ */

export function CrewOnboarding() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateErr(null);
    setJoinErr(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const weeklyGoal = num(fd.get("weeklyGoal")) ?? 5;
    if (!name) {
      setCreateErr("Name your crew.");
      return;
    }
    startTransition(async () => {
      const res = await createCrew({ name, weeklyGoal });
      if (!res.ok) {
        setCreateErr(res.error ?? "Could not create crew.");
        return;
      }
      router.refresh();
    });
  }

  function onJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateErr(null);
    setJoinErr(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "").trim();
    if (!code) {
      setJoinErr("Enter an invite code.");
      return;
    }
    startTransition(async () => {
      const res = await joinCrew(code);
      if (!res.ok) {
        setJoinErr(res.error ?? "Could not join that crew.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3.5">
      {/* Intro */}
      <div className="relative overflow-hidden rounded-card border border-line bg-surface p-6 text-center backdrop-blur-md">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-grad text-2xl">
          👊
        </div>
        <div className="font-display text-lg font-semibold uppercase tracking-wide text-text">
          Start a crew
        </div>
        <p className="mx-auto mt-2 max-w-[280px] text-sm text-muted">
          Crews are cooperative — you share a weekly goal, cheer each other on,
          and nudge anyone who hasn&apos;t trained. No rankings, ever.
        </p>
      </div>

      {/* Create a crew */}
      <div className="rounded-card border border-line bg-surface p-5 backdrop-blur-md">
        <div className="mb-3 font-display text-base font-semibold uppercase tracking-[0.04em] text-text">
          Create a crew
        </div>
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Crew name">
            <input
              name="name"
              type="text"
              placeholder="e.g. Dawn Patrol"
              className={inputCls}
              autoComplete="off"
            />
          </Field>
          <Field label="Weekly session goal (per member)" suffix="/ wk">
            <input
              name="weeklyGoal"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              defaultValue={5}
              placeholder="5"
              className={inputCls}
            />
          </Field>
          <ErrorNote message={createErr} />
          <SubmitBtn pending={pending} pendingLabel="Creating…">
            Create Crew
          </SubmitBtn>
        </form>
      </div>

      {/* Join with code */}
      <div className="rounded-card border border-dashed border-line-solid bg-surface p-5 backdrop-blur-md">
        <div className="mb-3 font-display text-base font-semibold uppercase tracking-[0.04em] text-text">
          Join with a code
        </div>
        <form onSubmit={onJoin} className="space-y-4">
          <Field label="Invite code">
            <input
              name="code"
              type="text"
              placeholder="e.g. RIDGE7"
              className={cx(inputCls, "uppercase tracking-[0.15em]")}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </Field>
          <ErrorNote message={joinErr} />
          <button
            type="submit"
            disabled={pending}
            className="mt-1 w-full rounded-[16px] border border-line bg-surface2 px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-text disabled:opacity-60"
          >
            {pending ? "Joining…" : "Join Crew"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Dropdown — tiny popover primitive (click-away + Escape to close)
   Shared by CrewSwitcher and CrewMenu.
   ════════════════════════════════════════════════════════════════════ */

function Dropdown({
  open,
  onClose,
  align = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cx(
        "absolute top-[calc(100%+8px)] z-30 w-60 overflow-hidden rounded-card border border-line-solid bg-surface-solid shadow-[0_20px_50px_rgba(0,0,0,.5)]",
        align === "right" ? "right-0" : "left-0",
      )}
      role="menu"
    >
      {children}
    </div>
  );
}

/* ── CrewSwitcher ──────────────────────────────────────────────────────
   Header dropdown listing the user's crews (listMyCrews → Crew[]). Selecting
   one calls setActiveCrew and refreshes so getCrewToday reflects it. The
   trigger doubles as the page title (the active crew name). Single-crew
   users see their crew name as a plain (non-interactive) title. */

export interface CrewSwitcherProps {
  crews: Crew[];
  activeCrewId: string;
  activeName: string;
  /** Current user id, to flag crews they lead. Null when signed out. */
  meId: string | null;
}

export function CrewSwitcher({ crews, activeCrewId, activeName, meId }: CrewSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const multi = crews.length > 1;

  function choose(crewId: string) {
    setOpen(false);
    if (crewId === activeCrewId) return;
    startTransition(async () => {
      const res = await setActiveCrew(crewId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => multi && setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup={multi ? "menu" : undefined}
        aria-expanded={multi ? open : undefined}
        className={cx(
          "-mx-1 mt-[3px] flex items-center gap-1.5 rounded-md px-1 text-left font-display text-3xl font-bold uppercase leading-none tracking-wide text-text",
          multi ? "transition-colors hover:text-accent" : "cursor-default",
        )}
      >
        <span className="max-w-[260px] truncate">{activeName}</span>
        {multi ? (
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className={cx(
              "h-5 w-5 flex-shrink-0 fill-none stroke-muted transition-transform [stroke-width:2.4]",
              open && "rotate-180",
            )}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : null}
      </button>

      <Dropdown open={open} onClose={() => setOpen(false)} align="left">
        <div className="border-b border-line px-3 py-2 font-cond text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          Switch crew
        </div>
        {crews.map((c) => {
          const isActive = c.id === activeCrewId;
          return (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              onClick={() => choose(c.id)}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface2",
                isActive && "bg-accent/10",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide text-text">
                  {c.name}
                </span>
                <span className="block text-[11px] text-muted">
                  {meId && c.created_by === meId ? "You lead" : "Member"}
                  {isActive ? " · active" : ""}
                </span>
              </span>
              {isActive ? (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="h-4 w-4 flex-shrink-0 fill-none stroke-accent2 [stroke-width:3]"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </Dropdown>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   CrewMenu — overflow / settings menu
   ─────────────────────────────────────────────────────────────────────
   • Join another crew (joinCrew via sheet)
   • Edit crew (creator only — editCrew name/weekly_goal via sheet)
   • Leave crew (leaveCrew with a confirm step)
   Member removal lives inline on each roster row (RemoveMemberButton) so
   it sits next to the person; this menu owns crew-level actions.
   ════════════════════════════════════════════════════════════════════ */

type MenuSheet = "join" | "edit" | "leave" | null;

export interface CrewMenuProps {
  crewId: string;
  crewName: string;
  weeklyGoal: number;
  isOwner: boolean;
}

export function CrewMenu({ crewId, crewName, weeklyGoal, isOwner }: CrewMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<MenuSheet>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSheet(null);
    setError(null);
  }

  function onJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "").trim();
    if (!code) {
      setError("Enter an invite code.");
      return;
    }
    startTransition(async () => {
      const res = await joinCrew(code);
      if (!res.ok) {
        setError(res.error ?? "Could not join that crew.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const goal = num(fd.get("weeklyGoal"));
    if (!name) {
      setError("Name can't be empty.");
      return;
    }
    startTransition(async () => {
      const res = await editCrew(crewId, {
        name,
        weeklyGoal: goal ?? weeklyGoal,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save changes.");
        return;
      }
      close();
      router.refresh();
    });
  }

  function onLeave() {
    setError(null);
    startTransition(async () => {
      const res = await leaveCrew(crewId);
      if (!res.ok) {
        setError(res.error ?? "Could not leave the crew.");
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Crew settings"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-text"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-5 w-5 fill-current"
        >
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      <Dropdown open={open} onClose={() => setOpen(false)} align="right">
        <MenuItem
          onClick={() => {
            setOpen(false);
            setError(null);
            setSheet("join");
          }}
        >
          Join another crew
        </MenuItem>
        {isOwner ? (
          <MenuItem
            onClick={() => {
              setOpen(false);
              setError(null);
              setSheet("edit");
            }}
          >
            Edit crew
          </MenuItem>
        ) : null}
        <MenuItem
          danger
          onClick={() => {
            setOpen(false);
            setError(null);
            setSheet("leave");
          }}
        >
          Leave crew
        </MenuItem>
      </Dropdown>

      {/* Join another crew */}
      <Sheet open={sheet === "join"} title="Join another crew" onClose={close}>
        <form onSubmit={onJoin} className="space-y-4">
          <Field label="Invite code">
            <input
              name="code"
              type="text"
              placeholder="e.g. RIDGE7"
              className={cx(inputCls, "uppercase tracking-[0.15em]")}
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
            />
          </Field>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending} pendingLabel="Joining…">
            Join Crew
          </SubmitBtn>
        </form>
      </Sheet>

      {/* Edit crew (creator only) */}
      <Sheet open={sheet === "edit"} title="Edit crew" onClose={close}>
        <form onSubmit={onEdit} className="space-y-4">
          <Field label="Crew name">
            <input
              name="name"
              type="text"
              defaultValue={crewName}
              placeholder="Crew name"
              className={inputCls}
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field label="Weekly session goal (per member)" suffix="/ wk">
            <input
              name="weeklyGoal"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              defaultValue={weeklyGoal}
              placeholder="5"
              className={inputCls}
            />
          </Field>
          <ErrorNote message={error} />
          <SubmitBtn pending={pending}>Save Changes</SubmitBtn>
        </form>
      </Sheet>

      {/* Leave crew (confirm) */}
      <Sheet open={sheet === "leave"} title="Leave crew?" onClose={close}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            You&apos;ll stop sharing progress with{" "}
            <b className="text-text">{crewName}</b> and lose access to its feed.
            You can rejoin later with the invite code.
          </p>
          <ErrorNote message={error} />
          <button
            type="button"
            onClick={onLeave}
            disabled={pending}
            className="w-full rounded-[16px] bg-danger px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg disabled:opacity-60"
          >
            {pending ? "Leaving…" : "Leave Crew"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="w-full rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.06em] text-text disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "block w-full border-b border-line px-3.5 py-3 text-left font-display text-sm font-semibold uppercase tracking-wide transition-colors last:border-b-0 hover:bg-surface2",
        danger ? "text-danger" : "text-text",
      )}
    >
      {children}
    </button>
  );
}

/* ── RemoveMemberButton ────────────────────────────────────────────────
   Per-member control shown to the crew creator on each roster row. A
   two-tap confirm guards an accidental removal; calls removeMember. */

export interface RemoveMemberButtonProps {
  crewId: string;
  userId: string;
  name: string;
}

export function RemoveMemberButton({ crewId, userId, name }: RemoveMemberButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reset the confirm state shortly after arming, so it doesn't linger.
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await removeMember(crewId, userId);
      if (res.ok) router.refresh();
      else setConfirming(false);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={`Remove ${name} from the crew`}
      className={cx(
        "flex-shrink-0 rounded-xl border px-3 py-2 font-cond text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-60",
        confirming
          ? "border-danger bg-danger/15 text-danger"
          : "border-line bg-surface2 text-muted",
      )}
    >
      {pending ? "…" : confirming ? "Confirm" : "Remove"}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
   NoteComposer — encouragement composer atop the Activity feed
   ─────────────────────────────────────────────────────────────────────
   Lets members post a note directly (postNote) rather than only via a
   completed session. Keeps the cooperative tone — it's framed as
   encouragement, not a status update.
   ════════════════════════════════════════════════════════════════════ */

export interface NoteComposerProps {
  crewId: string;
}

export function NoteComposer({ crewId }: NoteComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await postNote(crewId, text);
      if (!res.ok) {
        setError(res.error ?? "Could not post.");
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="relative mb-2.5 overflow-hidden rounded-card border border-line bg-surface p-3.5 backdrop-blur-md"
    >
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={280}
        placeholder="Drop some encouragement for the crew…"
        className="w-full resize-none bg-transparent font-body text-sm text-text outline-none placeholder:text-faint"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <ErrorNote message={error} />
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="ml-auto flex-shrink-0 rounded-xl bg-grad2 px-4 py-2 font-display text-xs font-semibold uppercase tracking-wide text-bg disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
