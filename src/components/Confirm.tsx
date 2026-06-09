"use client";

/* ════════════════════════════════════════════════════════════════════
   CONFIRM — in-app confirmation dialog (replaces window.confirm()).

   window.confirm/alert/prompt are banned: they block the page, can't be
   styled, and can't be driven by tests/automation. This provides an async,
   styled, accessible replacement:

     const confirm = useConfirm();
     if (!(await confirm({ title: "Delete?", destructive: true }))) return;

   The dialog renders through a <Portal> to <body> so its z-50 paints above
   the in-flow BottomNav — the same stacking rule the bottom sheets rely on.
   ════════════════════════════════════════════════════════════════════ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Portal } from "@/components/Portal";

export interface ConfirmOptions {
  title: string;
  /** Optional supporting line under the title. */
  message?: string;
  /** Label for the confirm button (default "Confirm"). */
  confirmLabel?: string;
  /** Label for the cancel button (default "Cancel"). */
  cancelLabel?: string;
  /** Style the confirm action as destructive (red) — default false. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Returns an async confirm() that resolves true (confirmed) / false (cancelled). */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts ? (
        <ConfirmDialog
          opts={opts}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open + close on Escape.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-label={opts.title}
    >
      <button
        type="button"
        aria-label={opts.cancelLabel ?? "Cancel"}
        onClick={onCancel}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-[360px] rounded-card border border-line-solid bg-surface-solid p-5 shadow-[0_20px_60px_rgba(0,0,0,.6)]">
        <h2 className="font-display text-lg font-bold uppercase tracking-[0.04em] text-text">
          {opts.title}
        </h2>
        {opts.message ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">{opts.message}</p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[14px] border border-line bg-surface px-4 py-3 font-display text-sm font-semibold uppercase tracking-wide text-text"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-[14px] px-4 py-3 font-display text-sm font-semibold uppercase tracking-wide ${
              opts.destructive ? "bg-danger text-bg" : "bg-grad text-on-grad"
            }`}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
