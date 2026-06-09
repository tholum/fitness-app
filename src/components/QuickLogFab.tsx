"use client";

/* ════════════════════════════════════════════════════════════════════
   QUICK-LOG FAB — Phase 6.

   The center nav FAB is a universal quick-log launcher. Tapping it opens a
   portaled bottom-sheet (the app's sheet pattern: <Portal> + fixed inset-0
   z-50) offering:

     • Check In — the primary daily action (start/complete today's session).
     • Each active goal — one tap to log TODAY:
         - daily_binary / specific_weekdays / times_per_week → tick today
           via logTracker (one row/day). The row shows done/undone state.
         - amount_per_week → needs a value, so it deep-links into the
           tracker's dedicated screen (the right place to enter an amount).

   Logging reuses the foundation's logTracker / unlogTracker actions, which
   also surface the goal into the crew feed (Phase 6 social). Never uses
   window.prompt/alert (global rule): every control is in-page and feedback
   is inline. Falls back gracefully when the user has no trackers.
   ════════════════════════════════════════════════════════════════════ */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import { cx } from "@/lib/cx";
import { logTracker, unlogTracker } from "@/lib/actions";
import { trackerHref, trackerIcon } from "@/lib/trackerNav";
import { todayISO } from "@/lib/format";
import type { CadenceType, TrackerType } from "@/lib/types";

/** Slim tracker shape the sheet needs (passed from the server layout). */
export interface QuickLogTracker {
  id: string;
  title: string;
  type: TrackerType;
  icon: string | null;
  cadenceType: CadenceType;
  unit: string | null;
}

export function QuickLogFab({ trackers }: { trackers: QuickLogTracker[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic "ticked today" set so a tapped row reflects immediately.
  const [tickedToday, setTickedToday] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  function tick(t: QuickLogTracker) {
    if (pending) return;
    setError(null);
    const already = tickedToday.has(t.id);
    // Optimistic toggle.
    setTickedToday((prev) => {
      const next = new Set(prev);
      if (already) next.delete(t.id);
      else next.add(t.id);
      return next;
    });
    startTransition(async () => {
      const res = already
        ? await unlogTracker(t.id, todayISO())
        : await logTracker({ trackerId: t.id, date: todayISO() });
      if (!res.ok) {
        // Roll back the optimistic toggle and surface the error inline.
        setTickedToday((prev) => {
          const next = new Set(prev);
          if (already) next.add(t.id);
          else next.delete(t.id);
          return next;
        });
        setError(res.error ?? "Could not log. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {/* The FAB itself — replaces the old direct /checkin link. */}
      {/* self-start + -mt-5 anchor the circle to the bar's top edge for a
          constant ~20px overhang on every device — items-center would vary
          the protrusion with the safe-area inset (the nav content box
          shrinks, pushing a centered FAB higher on notched phones). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick log"
        aria-haspopup="dialog"
        className="mx-1.5 -mt-5 flex h-[58px] w-[58px] flex-shrink-0 select-none items-center justify-center self-start rounded-full bg-grad shadow-[0_8px_22px_var(--fab-glow)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[26px] w-[26px] fill-none stroke-on-grad [stroke-width:2.6]"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <Sheet open={open} title="Quick Log" onClose={close} maxHeight="85dvh">
        {/* Primary: today's session check-in. */}
        <Link
                href="/checkin"
                onClick={close}
                className="mb-3 flex items-center gap-3 rounded-[16px] bg-grad px-4 py-3.5 text-on-grad shadow-[0_6px_18px_rgba(200,98,45,.28)]"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-on-grad/15 text-lg">
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold uppercase tracking-[0.04em]">
                    Check In
                  </span>
                  <span className="block font-cond text-[11px] uppercase tracking-wide text-on-grad/80">
                    Start or complete today&apos;s session
                  </span>
                </span>
                <span className="font-display" aria-hidden>
                  ›
                </span>
              </Link>

              {error ? (
                <p
                  aria-live="polite"
                  className="mb-2 font-cond text-xs font-semibold uppercase tracking-wide text-danger"
                >
                  {error}
                </p>
              ) : null}

              {/* Every goal — tick today, or open (amount needs a value). */}
              {trackers.length === 0 ? (
                <Link
                  href="/goals"
                  onClick={close}
                  className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5 text-left"
                >
                  <span className="text-lg">🎯</span>
                  <span className="flex-1 text-[13px] text-muted">
                    No goals yet — set one up to quick-log it here.
                  </span>
                  <span className="font-display text-gold" aria-hidden>
                    ›
                  </span>
                </Link>
              ) : (
                <ul className="space-y-2">
                  {trackers.map((t) => {
                    // exercise/diet are NOT backed by tracker_logs (exercise →
                    // session_logs, diet → nutrition_logs), and amount_per_week
                    // needs a value. All three deep-link into their dedicated
                    // screen rather than offering a dead inline tick.
                    const deepLink =
                      t.cadenceType === "amount_per_week" ||
                      t.type === "exercise" ||
                      t.type === "diet";
                    const done = tickedToday.has(t.id);
                    return (
                      <li key={t.id}>
                        {deepLink ? (
                          <Link
                            href={trackerHref(t.type)}
                            onClick={close}
                            className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-left"
                          >
                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-line bg-surface2 text-base">
                              {trackerIcon(t.type, t.icon)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.03em] text-text">
                                {t.title}
                              </span>
                              <span className="block font-cond text-[10px] uppercase tracking-wide text-faint">
                                {t.type === "exercise"
                                  ? "Open training →"
                                  : t.type === "diet"
                                    ? "Open nutrition →"
                                    : `Add ${t.unit ?? "amount"} →`}
                              </span>
                            </span>
                            <span className="font-display text-gold" aria-hidden>
                              ›
                            </span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => tick(t)}
                            disabled={pending}
                            aria-pressed={done}
                            className={cx(
                              "flex w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors disabled:opacity-60",
                              done
                                ? "border-line bg-surface"
                                : "border-line bg-surface",
                            )}
                          >
                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-line bg-surface2 text-base">
                              {trackerIcon(t.type, t.icon)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.03em] text-text">
                                {t.title}
                              </span>
                              <span className="block font-cond text-[10px] uppercase tracking-wide text-faint">
                                {done ? "Logged today — tap to undo" : "Tap to log today"}
                              </span>
                            </span>
                            <span
                              className={cx(
                                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                                done ? "bg-grad text-on-grad" : "border border-line text-faint",
                              )}
                              aria-hidden
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:3]">
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
      </Sheet>
    </>
  );
}
