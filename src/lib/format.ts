/**
 * Path Warden — unit + date formatting helpers.
 * Weight is stored in the DB in whatever the user's `units` implies for the UI,
 * but conversions here let screens render consistently regardless of source.
 */

import type { Units } from "@/lib/types";

// ── Unit conversion constants ────────────────────────────────────────────
const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 0.3937007874;

// ── Weight: kg <-> lb ────────────────────────────────────────────────────
export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

// ── Length: cm <-> in ────────────────────────────────────────────────────
export function cmToIn(cm: number): number {
  return cm * IN_PER_CM;
}

export function inToCm(inches: number): number {
  return inches / IN_PER_CM;
}

function round(value: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * Format a weight value for display. Input value is assumed to be in metric
 * (kg) — the canonical storage unit. Set `assumeMetric: false` if the value is
 * already in the target unit and only the label/rounding is needed.
 */
export function formatWeight(
  value: number | null | undefined,
  units: Units,
  opts: { assumeMetric?: boolean; places?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const { assumeMetric = true, places = 1 } = opts;
  if (units === "imperial") {
    const lb = assumeMetric ? kgToLb(value) : value;
    return `${round(lb, places)} lb`;
  }
  const kg = assumeMetric ? value : lbToKg(value);
  return `${round(kg, places)} kg`;
}

/**
 * Format a length value for display. Input value is assumed to be in metric
 * (cm). Set `assumeMetric: false` if the value is already in the target unit.
 */
export function formatLength(
  value: number | null | undefined,
  units: Units,
  opts: { assumeMetric?: boolean; places?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const { assumeMetric = true, places = 1 } = opts;
  if (units === "imperial") {
    const inches = assumeMetric ? cmToIn(value) : value;
    return `${round(inches, places)} in`;
  }
  const cm = assumeMetric ? value : inToCm(value);
  return `${round(cm, places)} cm`;
}

// ── Volume (water) ───────────────────────────────────────────────────────
const ML_PER_FLOZ = 29.5735295625;
const ML_PER_L = 1000;

/** Format a milliliter water amount: oz for imperial, L for metric. */
export function formatVolume(ml: number | null | undefined, units: Units): string {
  if (ml === null || ml === undefined || Number.isNaN(ml)) return "—";
  if (units === "imperial") return `${round(ml / ML_PER_FLOZ, 0)} oz`;
  return `${round(ml / ML_PER_L, 2)} L`;
}

// ── URL safety ───────────────────────────────────────────────────────────
/**
 * Validate a user-supplied "MTNTOUGH video" URL before it is stored or
 * rendered as an anchor href. Returns the trimmed URL only when it is an
 * https:// link to mtntough.com; otherwise returns null.
 *
 * This is the single source of truth for video-link safety. It rejects
 * dangerous schemes (javascript:, data:, vbscript:, etc.) that would
 * otherwise become stored XSS when the value is later rendered as an href,
 * and keeps the product constraint that videos live on mtntough.com.
 * Call it everywhere a `video_url` / `default_video_url` is written, and
 * defensively when rendering values that may predate this check.
 */
export function validateVideoUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // Only https is allowed — this excludes javascript:, data:, http:, etc.
  if (url.protocol !== "https:") return null;
  const host = url.host.toLowerCase();
  if (host !== "mtntough.com" && !host.endsWith(".mtntough.com")) return null;
  return trimmed;
}

// ── Date helpers ─────────────────────────────────────────────────────────
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Format a Date as a local ISO `YYYY-MM-DD` string (no timezone shift). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date as a local ISO `YYYY-MM-DD` string. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** Short weekday label ("Mon") for a Date or ISO date string. */
export function weekdayLabel(date: Date | string, long = false): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[d.getDay()];
}

/**
 * Start of the week (local) for a given date. `weekStartsOn` defaults to 1
 * (Monday); pass 0 for Sunday. Returns a new Date at local midnight.
 */
export function startOfWeek(date: Date | string = new Date(), weekStartsOn = 1): Date {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/** Start of the current week as an ISO date string. */
export function startOfWeekISO(weekStartsOn = 1): string {
  return toISODate(startOfWeek(new Date(), weekStartsOn));
}

/** The seven ISO dates of the week containing `date`. */
export function weekDates(date: Date | string = new Date(), weekStartsOn = 1): string[] {
  const start = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toISODate(d);
  });
}
