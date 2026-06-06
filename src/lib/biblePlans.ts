/**
 * Path Warden — built-in Bible reading plans (Phase 3).
 *
 * Lightweight, dependency-free reading-plan catalog. A plan is a fixed,
 * ordered list of daily passages; given a plan + a start date + "today", we can
 * resolve which passage is on deck for today. This is intentionally NOT a full
 * plan engine — it is a small suggestion layer that pairs with the day's
 * `logTracker` "mark read". The chosen plan reference is persisted in the bible
 * tracker's config jsonb as:
 *
 *     config.plan = { id, name, startDate }   // startDate = ISO YYYY-MM-DD
 *
 * (config-only — no extra table; see docs/expansion/phase-1-foundation.md §5.)
 *
 * Both this module and the bible screen share these definitions so the day's
 * passage is computed identically on the server (the reading card) and the
 * client (the plan picker preview).
 */

/** A persisted reference to a chosen plan (lives in tracker.config.plan). */
export interface PlanRef {
  /** Catalog id (see BIBLE_PLANS). */
  id: string;
  /** Snapshot of the plan name at selection time (display convenience). */
  name: string;
  /** ISO YYYY-MM-DD the user started the plan (day 1). */
  startDate: string;
}

/** A built-in plan: a name + an ordered list of one passage per day. */
export interface BiblePlan {
  id: string;
  name: string;
  /** Short tagline for the picker. */
  blurb: string;
  /** One passage string per day, in order (index 0 = day 1). */
  days: string[];
}

/** Total days in a plan. */
export function planLength(plan: BiblePlan): number {
  return plan.days.length;
}

/* ── Built-in catalog ──────────────────────────────────────────────────────
   Kept deliberately small. Two ready-to-go plans:
     • "Gospels in 30 days" — a month-long ride through Matthew→John.
     • "Proverbs (31)"      — a chapter a day, the classic month plan.
   Passages are human-readable reference strings (we suggest WHAT to read; the
   text itself stays in the reader's own Bible). */

/** Build a "Proverbs chapter N" plan (31 days). */
function proverbsDays(): string[] {
  return Array.from({ length: 31 }, (_, i) => `Proverbs ${i + 1}`);
}

/** A 30-day walk through the four Gospels (roughly even chapter chunks). */
const GOSPELS_30: string[] = [
  // Matthew (28 ch) — ~8 days
  "Matthew 1–3",
  "Matthew 4–6",
  "Matthew 7–9",
  "Matthew 10–12",
  "Matthew 13–15",
  "Matthew 16–19",
  "Matthew 20–24",
  "Matthew 25–28",
  // Mark (16 ch) — ~4 days
  "Mark 1–4",
  "Mark 5–8",
  "Mark 9–12",
  "Mark 13–16",
  // Luke (24 ch) — ~7 days
  "Luke 1–3",
  "Luke 4–6",
  "Luke 7–9",
  "Luke 10–12",
  "Luke 13–16",
  "Luke 17–20",
  "Luke 21–24",
  // John (21 ch) — ~6 days
  "John 1–3",
  "John 4–6",
  "John 7–9",
  "John 10–12",
  "John 13–15",
  "John 16–18",
  "John 19–21",
];

export const BIBLE_PLANS: readonly BiblePlan[] = [
  {
    id: "gospels-30",
    name: "Gospels in 30 Days",
    blurb: "Matthew through John in a month",
    days: GOSPELS_30,
  },
  {
    id: "proverbs-31",
    name: "Proverbs in 31 Days",
    blurb: "A chapter of wisdom a day",
    days: proverbsDays(),
  },
] as const;

/** Look up a plan in the catalog by id (null if unknown). */
export function getPlan(id: string | null | undefined): BiblePlan | null {
  if (!id) return null;
  return BIBLE_PLANS.find((p) => p.id === id) ?? null;
}

/**
 * Whole-day difference (today − start), local-midnight based, from two ISO
 * YYYY-MM-DD strings. 0 on the start date, 1 the next day, etc. Can be
 * negative if the plan's start is in the future.
 */
function dayDiff(startISO: string, todayISO: string): number {
  const start = new Date(`${startISO}T00:00:00`);
  const today = new Date(`${todayISO}T00:00:00`);
  const ms = today.getTime() - start.getTime();
  return Math.floor(ms / 86_400_000);
}

/** What today's reading resolves to for a plan. */
export interface TodaysReading {
  plan: BiblePlan;
  /** 1-based day number within the plan (clamped to [1, length]). */
  dayNumber: number;
  /** The passage reference string for today. */
  passage: string;
  /** Total days in the plan. */
  total: number;
  /** True once the plan has been completed (today is past the last day). */
  finished: boolean;
  /** True if the plan's start date is still in the future. */
  notStarted: boolean;
}

/**
 * Resolve today's reading for a chosen plan ref. Returns null when the plan id
 * is unknown. Before the start date → day 1 (notStarted=true). After the last
 * day → the final day (finished=true), so the card always suggests something.
 */
export function resolveTodaysReading(
  ref: PlanRef | null | undefined,
  todayISO: string,
): TodaysReading | null {
  const plan = getPlan(ref?.id);
  if (!plan || !ref) return null;

  const total = plan.days.length;
  const diff = dayDiff(ref.startDate, todayISO);
  const notStarted = diff < 0;
  const finished = diff >= total;
  // Clamp into [0, total-1] for the array lookup.
  const idx = Math.max(0, Math.min(total - 1, diff));

  return {
    plan,
    dayNumber: idx + 1,
    passage: plan.days[idx],
    total,
    finished,
    notStarted,
  };
}

/**
 * Read a PlanRef out of an untyped tracker.config jsonb (defensive). Returns
 * null when no valid plan is attached.
 */
export function readPlanRef(config: unknown): PlanRef | null {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const plan = cfg.plan as Record<string, unknown> | null | undefined;
  if (!plan || typeof plan !== "object") return null;
  const id = typeof plan.id === "string" ? plan.id : null;
  const startDate = typeof plan.startDate === "string" ? plan.startDate : null;
  if (!id || !startDate) return null;
  if (!getPlan(id)) return null; // unknown / removed plan → treat as none
  const name = typeof plan.name === "string" ? plan.name : getPlan(id)!.name;
  return { id, name, startDate };
}
