"use client";

/* ════════════════════════════════════════════════════════════════════
   SHEET — the app's single bottom-anchored modal primitive.

   Every overlay in the app shares the same chrome: a portaled, full-screen
   flex container anchored to the bottom, a blurred scrim that closes on tap,
   and a rounded surface panel with a drag handle and a title/close header.
   This component owns that chrome so screens only supply their body content.

   Rendered through <Portal> so it paints into document.body and its z-50
   always wins over the in-flow BottomNav (see Portal.tsx). a11y: role=dialog
   + aria-modal, the scrim button is labelled "Close", and Escape closes.
   ════════════════════════════════════════════════════════════════════ */

import { useEffect, type ReactNode } from "react";
import { Portal } from "@/components/Portal";

export interface SheetProps {
  open: boolean;
  /** Accessible name + visible header title. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Max panel height (CSS length). Defaults to 90dvh. */
  maxHeight?: string;
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  maxHeight = "90dvh",
}: SheetProps) {
  // Escape closes the sheet while it's open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // aria-label only accepts a string; fall back to undefined for rich titles.
  const ariaLabel = typeof title === "string" ? title : undefined;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        <div
          className="relative z-10 w-full max-w-[430px] overflow-y-auto rounded-t-card border border-b-0 border-line-solid bg-surface-solid px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-20px_60px_rgba(0,0,0,.6)]"
          style={{ maxHeight }}
        >
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
