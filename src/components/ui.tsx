"use client";

import { type ReactNode, type HTMLAttributes } from "react";

/* ════════════════════════════════════════════════════════════════════
   Path Warden UI primitives.
   Generic, typed building blocks used across every screen. Styling is
   strictly via theme-token Tailwind classes (bg-surface, text-text, …)
   so they re-skin automatically with the active theme/accent.
   ════════════════════════════════════════════════════════════════════ */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Card ──────────────────────────────────────────────────────────── */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Glassy surface card: translucent surface, hairline border, rounded. */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-card border border-line bg-surface backdrop-blur-md",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── SectionHeader ─────────────────────────────────────────────────── */
export interface SectionHeaderProps {
  /** Left-hand section title (uppercased display type). */
  children: ReactNode;
  /** Optional trailing action (link/button) rendered on the right. */
  action?: ReactNode;
  className?: string;
}

/** Uppercase Oswald section label with an optional right-aligned action. */
export function SectionHeader({ children, action, className }: SectionHeaderProps) {
  return (
    <div
      className={cx(
        "mx-1 mb-3 mt-5 flex items-center justify-between font-display text-base font-semibold uppercase tracking-[0.094em] text-text",
        className,
      )}
    >
      <span>{children}</span>
      {action ? (
        <span className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold">
          {action}
        </span>
      ) : null}
    </div>
  );
}

/* ── Ring ──────────────────────────────────────────────────────────── */
export interface RingProps {
  /** Progress 0–1. Values are clamped. */
  value: number;
  /** Stroke color (any CSS color, e.g. "var(--accent)"). */
  color?: string;
  /** Outer pixel size of the SVG. */
  size?: number;
  /** Stroke width in px. */
  stroke?: number;
  /** Optional centered label (e.g. "79%"). */
  label?: ReactNode;
  className?: string;
}

/** SVG progress ring. Stroke sweeps clockwise from 12 o'clock. */
export function Ring({
  value,
  color = "var(--accent)",
  size = 56,
  stroke = 6,
  label,
  className,
}: RingProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped);
  const center = size / 2;

  return (
    <div className={cx("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      {label != null ? (
        <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-text">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/* ── StatPill ──────────────────────────────────────────────────────── */
export interface StatPillProps {
  children: ReactNode;
  className?: string;
}

/** Rounded surface pill for compact stats (streaks, durations, counts). */
export function StatPill({ children, className }: StatPillProps) {
  return (
    <div
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-display text-[15px] font-bold text-text",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Toggle ────────────────────────────────────────────────────────── */
export interface ToggleProps {
  /** Controlled on/off state. */
  checked: boolean;
  /** Called with the next value when toggled. */
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** Controlled switch styled like the prototype's .swt control. */
export function Toggle({
  checked,
  onChange,
  disabled,
  className,
  ...rest
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cx(
        "relative h-7 w-12 flex-shrink-0 rounded-[15px] transition-colors duration-200",
        checked ? "bg-accent2" : "bg-line-solid",
        disabled && "opacity-50",
        className,
      )}
      {...rest}
    >
      <span
        className={cx(
          "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-text transition-all duration-200",
          checked ? "left-[23px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

/* ── Segmented ─────────────────────────────────────────────────────── */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

/** Button-group segmented control; the active option gets the gradient. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      className={cx(
        "flex rounded-[14px] border border-line bg-surface p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cx(
              "flex-1 rounded-[10px] p-2.5 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
              active ? "bg-grad text-bg" : "text-muted",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
