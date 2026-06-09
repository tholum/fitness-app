"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Card, SectionHeader, Toggle } from "@/components/ui";
import { useHaptics } from "@/components/ThemeProvider";
import { completeSession, toggleBlock, markNudgesSeen } from "@/lib/actions";
import type { BlockType, Json, Units } from "@/lib/types";

/* ════════════════════════════════════════════════════════════════════
   CHECK IN — interactive client surface.
   Renders the session block checklist (round check toggles), a REAL per-
   block detail input (weight/sets/reps for strength, time/distance for
   conditioning) that writes into each block's payload, plus session-level
   capture (RPE 1–10, an editable actual-duration, and notes). On Mark
   Complete it passes rpe/notes/durationMin and per-block detail through
   completeSession. Data is loaded server-side and handed down as `initial`.

   Two block sources are unified here:
     • Persisted blocks (from block_completions) carry a real `id`; ticking
       them calls toggleBlock() so the DB stays in sync mid-session.
     • Program-sourced blocks (from program_blocks, no session log yet) have
       no `id`; ticking is local-only and persisted on Mark Complete.

   Also exports NudgeInbox — the cooperative incoming-nudge banner shown on
   Today, which marks nudges seen on mount.
   ════════════════════════════════════════════════════════════════════ */

/** A single checklist row, normalized from either data source. */
export interface CheckinBlock {
  /** block_completions.id when persisted; null when program-sourced. */
  id: string | null;
  label: string;
  type: BlockType | null;
  /** Sub-label, e.g. "5×5", "8 min · dynamic prep", "3 mi · 35 lb". */
  detail: string | null;
  done: boolean;
  /** Optional structured payload already logged for this block. */
  payload?: Json | null;
}

export interface CheckinClientProps {
  /** Session log id when one already exists; null for a fresh check-in. */
  sessionLogId: string | null;
  programDayId: string | null;
  title: string;
  description: string;
  videoUrl: string | null;
  /** Crew to post the completion to (null → no crew yet / nothing posted). */
  crewId: string | null;
  /** Estimated session length in minutes (header pill + duration default). */
  estMinutes: number | null;
  /** Whether the session is already marked complete. */
  alreadyComplete: boolean;
  /** Profile units, used to label the optional weight affordance. */
  units: Units;
  blocks: CheckinBlock[];
}

/* ── Detail payload helpers ───────────────────────────────────────────────
   Each row keeps a small structured draft that maps 1:1 onto the keys
   deriveDetail() (checkin/page.tsx) already understands: weight / sets /
   reps / distance / time. We persist only non-empty fields so an untouched
   block writes null (not an empty object). */

interface BlockDraft {
  weight: string;
  sets: string;
  reps: string;
  distance: string;
  time: string;
}

const EMPTY_DRAFT: BlockDraft = {
  weight: "",
  sets: "",
  reps: "",
  distance: "",
  time: "",
};

/** Seed a per-block draft from any structured payload already logged. */
function draftFromPayload(payload: Json | null | undefined): BlockDraft {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ...EMPTY_DRAFT };
  }
  const rec = payload as Record<string, Json | undefined>;
  const str = (v: Json | undefined) => (v == null ? "" : String(v));
  return {
    weight: str(rec.weight),
    sets: str(rec.sets),
    reps: str(rec.reps),
    distance: str(rec.distance),
    time: str(rec.time),
  };
}

/** Collapse a draft into a payload object (number-coerced where sensible),
 *  or null when nothing was entered. */
function payloadFromDraft(type: BlockType | null, draft: BlockDraft): Json | null {
  const out: Record<string, Json> = {};
  const numOrStr = (s: string): Json => {
    const t = s.trim();
    if (t === "") return "";
    const n = Number(t);
    return Number.isFinite(n) && /^-?\d*\.?\d+$/.test(t) ? n : t;
  };

  if (type === "conditioning") {
    if (draft.distance.trim()) out.distance = numOrStr(draft.distance);
    if (draft.time.trim()) out.time = draft.time.trim();
  } else {
    // strength + everything else captures weight / sets × reps
    if (draft.weight.trim()) out.weight = numOrStr(draft.weight);
    if (draft.sets.trim()) out.sets = numOrStr(draft.sets);
    if (draft.reps.trim()) out.reps = draft.reps.trim();
  }

  return Object.keys(out).length ? (out as Json) : null;
}

/** Whether a block type gets a detail input at all (warmup/mobility don't). */
function hasDetailInput(type: BlockType | null): boolean {
  return type === "strength" || type === "conditioning" || type === "other";
}

/* ── Per-type icon tile (gradient + glyph), ported from the prototype ── */

function blockGradient(type: BlockType | null): string {
  switch (type) {
    case "warmup":
      return "var(--grad2)"; // moss → blaze
    case "mobility":
      return "linear-gradient(135deg,#d9a441,#c8622d)"; // gold → blaze
    case "strength":
    case "conditioning":
    case "other":
    default:
      return "var(--grad)"; // blaze → gold
  }
}

function BlockGlyph({ type }: { type: BlockType | null }) {
  switch (type) {
    case "warmup":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 3v9l5 3" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "conditioning":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 20l5-9 4 5 7-11" />
        </svg>
      );
    case "mobility":
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
        </svg>
      );
    case "strength":
    case "other":
    default:
      return (
        <svg viewBox="0 0 24 24">
          <path d="M6 12h12M4 9v6M20 9v6M8 6v12M16 6v12" />
        </svg>
      );
  }
}

/* ── Shared input styling (matches the Body log sheet) ───────────────── */

const inputCls =
  "w-full rounded-[10px] border border-line bg-bg2 px-2.5 py-2 font-display text-sm text-text outline-none placeholder:text-faint focus:border-accent";

function MiniField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block font-cond text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ── Round check toggle (the prototype's .check / .check.done) ───────── */

function CheckCircle({
  label,
  done,
  busy,
  onClick,
}: {
  /** Block label, used to give this icon-only checkbox an accessible name. */
  label: string;
  done: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`Mark ${label} complete`}
      onClick={onClick}
      disabled={busy}
      className={`flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
        done
          ? "border-accent2 bg-accent2"
          : "border-line-solid bg-bg2"
      } ${busy ? "opacity-60" : ""}`}
    >
      {done ? (
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px] fill-none stroke-on-grad [stroke-width:3]"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      ) : null}
    </button>
  );
}

/* ── Watch on MTNTOUGH button ────────────────────────────────────────── */

function WatchButton({ videoUrl }: { videoUrl: string | null }) {
  const inner: ReactNode = (
    <>
      <svg
        viewBox="0 0 24 24"
        className="mr-1.5 h-4 w-4 fill-current align-[-2px]"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      Watch on MTNTOUGH ↗
    </>
  );
  const className =
    "flex w-full items-center justify-center rounded-[18px] bg-surface2 p-[13px] font-display text-[13px] font-semibold uppercase tracking-wide text-text";

  if (videoUrl) {
    return (
      <a
        href={videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" disabled className={`${className} opacity-50`}>
      {inner}
    </button>
  );
}

/* ── RPE selector (1–10 chips) ───────────────────────────────────────── */

function RpeSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={active}
            // Tapping the active chip clears it (RPE is optional).
            onClick={() => onChange(active ? null : n)}
            className={`h-9 w-full rounded-[10px] border font-display text-sm font-bold transition-colors ${
              active
                ? "border-transparent bg-grad text-on-grad"
                : "border-line bg-surface2 text-text"
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main client component ───────────────────────────────────────────── */

export function CheckinClient({
  sessionLogId,
  programDayId,
  title,
  description,
  videoUrl,
  crewId,
  estMinutes,
  alreadyComplete,
  units,
  blocks: initialBlocks,
}: CheckinClientProps) {
  const router = useRouter();
  const buzz = useHaptics();
  const [blocks, setBlocks] = useState<CheckinBlock[]>(initialBlocks);
  const [drafts, setDrafts] = useState<BlockDraft[]>(() =>
    initialBlocks.map((b) => draftFromPayload(b.payload)),
  );
  /** Which rows have their detail input expanded. */
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(new Set());
  const [share, setShare] = useState(true);
  const [complete, setComplete] = useState(alreadyComplete);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** ids (or indices) of rows with an in-flight toggle, to disable them. */
  const [busyRows, setBusyRows] = useState<ReadonlySet<number>>(new Set());
  const [isCompleting, startCompleting] = useTransition();

  // Session-level capture. Duration DEFAULTS to the program estimate but is
  // freely editable (not forced to the estimate).
  const [rpe, setRpe] = useState<number | null>(null);
  const [durationStr, setDurationStr] = useState<string>(
    estMinutes != null ? String(estMinutes) : "",
  );
  const [notes, setNotes] = useState<string>("");

  const weightLabel = units === "imperial" ? "Weight (lb)" : "Weight (kg)";

  const doneCount = useMemo(() => blocks.filter((b) => b.done).length, [blocks]);
  const allDone = blocks.length > 0 && doneCount === blocks.length;

  function setRowBusy(index: number, busy: boolean) {
    setBusyRows((prev) => {
      const next = new Set(prev);
      if (busy) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function toggleRowOpen(index: number) {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function updateDraft(index: number, patch: Partial<BlockDraft>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function handleToggle(index: number) {
    setErrorMsg(null);
    const block = blocks[index];
    const nextDone = !block.done;

    // Light haptic tick when checking a block off (Appearance → Haptics).
    if (nextDone) buzz(12);

    // Optimistic local update.
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, done: nextDone } : b)),
    );

    // Persist immediately only when the row already lives in the DB.
    if (block.id) {
      setRowBusy(index, true);
      const id = block.id;
      void toggleBlock(id, nextDone)
        .then((res) => {
          if (!res.ok) {
            // Roll back on failure.
            setBlocks((prev) =>
              prev.map((b, i) =>
                i === index ? { ...b, done: block.done } : b,
              ),
            );
            setErrorMsg(res.error ?? "Couldn't update that block.");
          }
        })
        .catch(() => {
          setBlocks((prev) =>
            prev.map((b, i) => (i === index ? { ...b, done: block.done } : b)),
          );
          setErrorMsg("Couldn't update that block.");
        })
        .finally(() => setRowBusy(index, false));
    }
  }

  function handleComplete() {
    if (complete || isCompleting) return;
    setErrorMsg(null);

    // Fold each block's draft into a structured payload for persistence.
    const durationNum = (() => {
      const t = durationStr.trim();
      if (t === "") return estMinutes ?? undefined;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n) : estMinutes ?? undefined;
    })();

    startCompleting(async () => {
      const res = await completeSession({
        sessionLogId: sessionLogId ?? undefined,
        programDayId: programDayId ?? undefined,
        title,
        durationMin: durationNum,
        rpe: rpe ?? undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        shared: share,
        crewId: share ? crewId : null,
        blocks: blocks.map((b, i) => ({
          label: b.label,
          type: b.type ?? undefined,
          done: b.done,
          detail: payloadFromDraft(b.type, drafts[i]) ?? b.payload ?? undefined,
        })),
      });

      if (!res.ok) {
        setErrorMsg(res.error ?? "Couldn't complete the session.");
        return;
      }
      // Celebratory buzz on a successful check-in (Appearance → Haptics).
      buzz([18, 40, 28]);
      setComplete(true);
      router.push("/today");
      router.refresh();
    });
  }

  return (
    <>
      {/* Session summary + Watch on MTNTOUGH */}
      <Card className="mb-[14px] p-4">
        <div className="font-display text-[20px] font-bold uppercase tracking-[0.025em] text-text">
          {title}
        </div>
        <p className="mb-[14px] mt-1 text-[13px] text-muted">{description}</p>
        <WatchButton videoUrl={videoUrl} />
      </Card>

      <SectionHeader>Session Blocks</SectionHeader>

      {blocks.length === 0 ? (
        <Card className="p-5 text-center">
          <p className="text-[13px] text-muted">
            No blocks listed for this session. You can still mark it complete
            once you&apos;ve finished your work.
          </p>
        </Card>
      ) : (
        blocks.map((block, index) => {
          const busy = busyRows.has(index);
          const open = openRows.has(index);
          const canLog = hasDetailInput(block.type);
          const draft = drafts[index] ?? EMPTY_DRAFT;
          const affordanceLabel =
            block.type === "conditioning" ? "+ log time/distance" : "+ log weight/reps";
          return (
            <Card
              key={block.id ?? `seed-${index}`}
              className="mb-[10px] p-[14px]"
            >
              <div className="flex items-center gap-[14px]">
                <div
                  className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[13px] [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:fill-none [&_svg]:stroke-on-grad [&_svg]:[stroke-width:2]"
                  style={{ background: blockGradient(block.type) }}
                >
                  <BlockGlyph type={block.type} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-display text-[15px] font-semibold uppercase tracking-[0.025em] text-text">
                    {block.label}
                  </div>
                  <div className="mt-px text-xs text-muted">
                    {block.detail ? <span>{block.detail}</span> : null}
                    {block.detail && canLog ? <span> · </span> : null}
                    {canLog ? (
                      <button
                        type="button"
                        onClick={() => toggleRowOpen(index)}
                        aria-expanded={open}
                        className="text-gold underline-offset-2 hover:underline"
                      >
                        {open ? "− hide" : affordanceLabel}
                      </button>
                    ) : null}
                    {!block.detail && !canLog ? <span>Tap to check off</span> : null}
                  </div>
                </div>

                <CheckCircle
                  label={block.label}
                  done={block.done}
                  busy={busy}
                  onClick={() => handleToggle(index)}
                />
              </div>

              {/* Real detail input (replaces the prototype's static gold span). */}
              {canLog && open ? (
                <div className="mt-3 border-t border-line pt-3">
                  {block.type === "conditioning" ? (
                    <div className="flex gap-2.5">
                      <MiniField label="Distance (mi)">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          placeholder="3"
                          value={draft.distance}
                          onChange={(e) =>
                            updateDraft(index, { distance: e.target.value })
                          }
                          className={inputCls}
                        />
                      </MiniField>
                      <MiniField label="Time">
                        <input
                          type="text"
                          inputMode="text"
                          placeholder="35 min"
                          value={draft.time}
                          onChange={(e) =>
                            updateDraft(index, { time: e.target.value })
                          }
                          className={inputCls}
                        />
                      </MiniField>
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <MiniField label={weightLabel}>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          placeholder="185"
                          value={draft.weight}
                          onChange={(e) =>
                            updateDraft(index, { weight: e.target.value })
                          }
                          className={inputCls}
                        />
                      </MiniField>
                      <MiniField label="Sets">
                        <input
                          type="number"
                          inputMode="numeric"
                          step="1"
                          placeholder="5"
                          value={draft.sets}
                          onChange={(e) =>
                            updateDraft(index, { sets: e.target.value })
                          }
                          className={inputCls}
                        />
                      </MiniField>
                      <MiniField label="Reps">
                        <input
                          type="text"
                          inputMode="text"
                          placeholder="5"
                          value={draft.reps}
                          onChange={(e) =>
                            updateDraft(index, { reps: e.target.value })
                          }
                          className={inputCls}
                        />
                      </MiniField>
                    </div>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      {/* ── Session detail capture: RPE · duration · notes ─────────────── */}
      <SectionHeader>How&apos;d It Go</SectionHeader>
      <Card className="space-y-4 p-4">
        <div>
          <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
            Effort (RPE)
          </span>
          <RpeSelector value={rpe} onChange={setRpe} />
        </div>

        <label className="block">
          <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
            Actual duration (min)
          </span>
          <input
            name="duration"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            placeholder={estMinutes != null ? String(estMinutes) : "45"}
            className="w-full rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none placeholder:text-faint focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
            Notes
          </span>
          <textarea
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How it felt, what to tweak next time…"
            className="w-full resize-none rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-body text-sm text-text outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
      </Card>

      {/* Share to crew — a real link to /crew when the user is crew-less. */}
      {crewId ? (
        <Card className="mt-4 flex items-center justify-between p-[14px]">
          <div>
            <div className="font-display text-sm uppercase tracking-[0.025em] text-text">
              Share to crew
            </div>
            <div className="text-[11px] text-muted">
              Post completion to your feed
            </div>
          </div>
          <Toggle
            checked={share}
            onChange={setShare}
            aria-label="Share completion to crew"
          />
        </Card>
      ) : (
        <Link href="/crew" className="mt-4 block">
          <Card className="flex items-center justify-between p-[14px] transition-colors hover:bg-surface2">
            <div>
              <div className="font-display text-sm uppercase tracking-[0.025em] text-text">
                Share to crew
              </div>
              <div className="text-[11px] text-muted">
                Join a crew to share your sessions
              </div>
            </div>
            <span className="font-display text-gold">Join a crew ›</span>
          </Card>
        </Link>
      )}

      {errorMsg ? (
        <p className="mx-1 mt-3 text-[12px] text-danger">{errorMsg}</p>
      ) : null}

      {/* Mark Session Complete */}
      <button
        type="button"
        onClick={handleComplete}
        disabled={complete || isCompleting}
        className="mt-[14px] w-full rounded-[18px] bg-grad p-[17px] font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-on-grad shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
      >
        {complete
          ? "✓ Session Complete"
          : isCompleting
            ? "Saving…"
            : allDone || blocks.length === 0
              ? "✓ Mark Session Complete"
              : `✓ Mark Session Complete (${doneCount}/${blocks.length})`}
      </button>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   NudgeInbox — cooperative incoming-nudge banner (rendered on Today).
   Shows "<Name> nudged you" for any incoming nudges and fires
   markNudgesSeen() once on mount so the unseen badge clears after viewing.
   No competitive framing — purely supportive accountability.
   ════════════════════════════════════════════════════════════════════ */

export interface NudgeInboxItem {
  id: string;
  fromName: string;
  createdAt: string;
  seen: boolean;
}

export interface NudgeInboxProps {
  nudges: NudgeInboxItem[];
  /** How many are still unseen (drives the "new" emphasis). */
  unseenCount: number;
}

function nudgeHeadline(nudges: NudgeInboxItem[]): string {
  const names = Array.from(new Set(nudges.map((n) => n.fromName).filter(Boolean)));
  if (names.length === 0) return "Your crew nudged you";
  if (names.length === 1) return `${names[0]} nudged you`;
  if (names.length === 2) return `${names[0]} & ${names[1]} nudged you`;
  return `${names[0]} & ${names.length - 1} others nudged you`;
}

export function NudgeInbox({ nudges, unseenCount }: NudgeInboxProps) {
  // Hide the banner once dismissed for this view. getNudges returns only
  // unseen nudges, so after markNudgesSeen() revalidates /today this banner
  // naturally clears on the next render.
  const [dismissed, setDismissed] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    // Fire once on mount when there are unseen nudges to acknowledge.
    if (firedRef.current || unseenCount <= 0) return;
    firedRef.current = true;
    void markNudgesSeen().catch(() => {
      /* Non-critical: the banner still renders; next load reconciles. */
    });
  }, [unseenCount]);

  if (dismissed || nudges.length === 0) return null;

  const headline = nudgeHeadline(nudges);
  const isNew = unseenCount > 0;

  return (
    <Card className="relative z-10 mb-3.5 flex items-center gap-3 border-dashed border-line-solid p-3.5">
      <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full bg-grad2 text-lg">
        👊
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-sm font-semibold uppercase tracking-wide text-text">
            {headline}
          </span>
          {isNew ? (
            <span className="flex-shrink-0 rounded-full bg-accent2 px-1.5 py-0.5 font-cond text-[9px] font-bold uppercase tracking-wide text-on-grad">
              New
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-muted">
          Your crew&apos;s got your back — get after today&apos;s session.
        </div>
      </div>
      <Link
        href="/crew"
        className="flex-shrink-0 font-cond text-[11px] font-semibold uppercase tracking-wide text-gold"
      >
        Crew ›
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 fill-none stroke-current [stroke-width:2.4]"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </Card>
  );
}
