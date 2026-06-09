"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card, Toggle } from "@/components/ui";
import type { Accent } from "@/components/ThemeProvider";

/* ════════════════════════════════════════════════════════════════════
   APPEARANCE — co-located client building blocks.
   These are presentational pieces specific to the Appearance screen
   (accent swatches, labelled option cards, toggle rows, and the
   reorderable / toggleable Home Cards list). Everything styles via the
   theme-token Tailwind classes so it re-skins with the live theme.
   ════════════════════════════════════════════════════════════════════ */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── OptionCard ─────────────────────────────────────────────────────── */
/** Glass card with an Oswald label, muted description, and a control. */
export function OptionCard({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="mb-3 p-4">
      <div className="font-display text-[15px] font-semibold uppercase tracking-wide text-text">
        {label}
      </div>
      <div className="mb-3 mt-1 text-xs leading-relaxed text-muted">{description}</div>
      {children}
    </Card>
  );
}

/* ── Accent swatches ────────────────────────────────────────────────── */
export interface AccentSwatch {
  value: Accent;
  /** CSS gradient string matching the token gradient for this accent. */
  gradient: string;
  label: string;
}

/**
 * Four gradient swatches. Selecting one drives [data-accent] via the
 * provider; the active swatch gets a white ring + check (per prototype).
 */
export function AccentSwatches({
  swatches,
  value,
  onChange,
}: {
  swatches: ReadonlyArray<AccentSwatch>;
  value: Accent;
  onChange: (next: Accent) => void;
}) {
  return (
    <div className="flex gap-3">
      {swatches.map((s) => {
        const selected = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-label={s.label}
            aria-pressed={selected}
            onClick={() => onChange(s.value)}
            style={{ backgroundImage: s.gradient }}
            className={cx(
              "relative h-[54px] flex-1 rounded-[14px] border-2 bg-origin-border transition-colors",
              selected ? "border-text" : "border-transparent",
            )}
          >
            {selected ? (
              <span className="absolute right-2 top-1 font-display text-base font-extrabold leading-none text-on-grad">
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── ToggleRow ──────────────────────────────────────────────────────── */
/** A label/description + Toggle row, used inside a grouped card. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  bordered,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Draw a top hairline (for stacked rows after the first). */
  bordered?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between p-4",
        bordered && "border-t border-line",
      )}
    >
      <div className="min-w-0 pr-3">
        <div className="font-display text-[15px] font-semibold uppercase tracking-[0.03em] text-text">
          {label}
        </div>
        <div className="mt-0.5 text-xs text-muted">{description}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

/* ── Home Cards (reorderable + toggleable) ──────────────────────────── */
export interface HomeCardDef {
  /** Stable widget key persisted in appearance.widgets. */
  key: string;
  label: string;
}

interface ChevProps {
  dir: "up" | "down";
}
function Chevron({ dir }: ChevProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.2]"
    >
      {dir === "up" ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

/**
 * Reorderable + toggleable list of Today home cards.
 *
 * `order` is the FULL ordering of every card key (enabled and disabled);
 * `enabled` is the set currently shown on Today. We keep the full order in
 * local state for smooth drag/▲▼ UX and surface the enabled subset (in this
 * order) to the parent, which persists it as appearance.widgets (string[]).
 */
export function HomeCardsList({
  cards,
  order,
  enabled,
  onReorder,
  onToggle,
}: {
  cards: ReadonlyArray<HomeCardDef>;
  order: ReadonlyArray<string>;
  enabled: ReadonlyArray<string>;
  onReorder: (nextOrder: string[]) => void;
  onToggle: (key: string, next: boolean) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const labelOf = useMemo(() => {
    const m = new Map(cards.map((c) => [c.key, c.label] as const));
    return (k: string) => m.get(k) ?? k;
  }, [cards]);

  const enabledSet = useMemo(() => new Set(enabled), [enabled]);

  function move(key: string, delta: -1 | 1) {
    const idx = order.indexOf(key);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorder(next);
  }

  function reorderByDrag(from: string, to: string) {
    if (from === to) return;
    const next = [...order];
    const fromIdx = next.indexOf(from);
    const toIdx = next.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    onReorder(next);
  }

  return (
    <div>
      {order.map((key, i) => {
        const on = enabledSet.has(key);
        const isOver = overKey === key && dragKey !== null && dragKey !== key;
        return (
          <Card
            key={key}
            draggable
            onDragStart={() => setDragKey(key)}
            onDragEnter={() => setOverKey(key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragKey) reorderByDrag(dragKey, key);
              setDragKey(null);
              setOverKey(null);
            }}
            onDragEnd={() => {
              setDragKey(null);
              setOverKey(null);
            }}
            className={cx(
              "mb-2.5 flex items-center gap-3 px-4 py-[15px] transition-[opacity,border-color]",
              dragKey === key && "opacity-50",
              isOver && "border-accent",
            )}
          >
            <span
              aria-hidden
              className="cursor-grab select-none text-lg leading-none text-faint active:cursor-grabbing"
              title="Drag to reorder"
            >
              ⠿
            </span>
            <span
              className={cx(
                "flex-1 font-display text-sm uppercase tracking-[0.03em]",
                on ? "text-text" : "text-muted",
              )}
            >
              {labelOf(key)}
            </span>

            {/* ▲▼ reorder controls (touch-friendly fallback for drag). */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move ${labelOf(key)} up`}
                disabled={i === 0}
                onClick={() => move(key, -1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:text-text disabled:opacity-30"
              >
                <Chevron dir="up" />
              </button>
              <button
                type="button"
                aria-label={`Move ${labelOf(key)} down`}
                disabled={i === order.length - 1}
                onClick={() => move(key, 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:text-text disabled:opacity-30"
              >
                <Chevron dir="down" />
              </button>
            </div>

            <Toggle
              checked={on}
              onChange={(next) => onToggle(key, next)}
              aria-label={`Show ${labelOf(key)} on Today`}
            />
          </Card>
        );
      })}
    </div>
  );
}
