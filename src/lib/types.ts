/**
 * BASECAMP — TypeScript interfaces for every table in
 * supabase/migrations/0001_init.sql and 0002_features.sql. Column names/types
 * mirror the schema exactly so query/action code can stay typed without
 * generated DB types.
 */

// ── Shared scalar aliases ───────────────────────────────────────────────
export type UUID = string;
/** Postgres `date` rendered as an ISO `YYYY-MM-DD` string. */
export type ISODate = string;
/** Postgres `timestamptz` rendered as an ISO timestamp string. */
export type ISOTimestamp = string;
/** Arbitrary JSON payloads (jsonb columns). */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ── Enumerated column values ────────────────────────────────────────────
export type Units = "imperial" | "metric";
/** Training-goal mode (0009): specific weekdays vs. a flexible weekly count. */
export type GoalType = "days" | "count";
export type CrewRole = "owner" | "member";
export type ProgramSource = "MTNTOUGH" | "custom" | string;
export type BlockType =
  | "warmup"
  | "strength"
  | "conditioning"
  | "mobility"
  | "other";
export type FeedKind = "session" | "pr" | "badge" | "note";

// ── PROFILES ─────────────────────────────────────────────────────────────
export interface Profile {
  id: UUID;
  display_name: string;
  avatar_url: string | null;
  units: Units;
  /**
   * Raw `profiles.appearance` jsonb. The typed/normalized shape lives in
   * "@/components/ThemeProvider" (Appearance), which is the single source of
   * truth; normalize via ThemeProvider.normalizeAppearance() before use.
   */
  appearance: Json;
  /** Active crew for multi-crew switching (0002); null falls back to first membership. */
  active_crew_id: UUID | null;
  /**
   * Training-goal mode driving the streak (0009):
   *   "days"  → streak counts the scheduled weekdays in `training_days`,
   *             skipping rest days.
   *   "count" → streak counts consecutive weeks hitting `weekly_target`.
   */
  goal_type: GoalType;
  /** Scheduled weekdays for "days" mode: ints 0=Sun..6=Sat (Postgres dow). */
  training_days: number[];
  /** Weekly session target for "count" mode (1..7). */
  weekly_target: number;
  streak_count: number;
  xp: number;
  level: number;
  created_at: ISOTimestamp;
}

// ── CREWS ────────────────────────────────────────────────────────────────
export interface Crew {
  id: UUID;
  name: string;
  invite_code: string;
  weekly_goal: number;
  created_by: UUID;
  created_at: ISOTimestamp;
}

export interface CrewMember {
  crew_id: UUID;
  user_id: UUID;
  role: CrewRole;
  joined_at: ISOTimestamp;
}

// ── PROGRAM CONTENT ──────────────────────────────────────────────────────
export interface Program {
  id: UUID;
  name: string;
  source: ProgramSource;
  owner_id: UUID | null;
  is_public: boolean;
  created_at: ISOTimestamp;
}

export interface ProgramDay {
  id: UUID;
  program_id: UUID;
  phase: number;
  week: number;
  day: number;
  title: string;
  est_minutes: number | null;
  video_url: string | null;
  order: number;
}

export interface ProgramBlock {
  id: UUID;
  program_day_id: UUID;
  label: string;
  type: BlockType;
  detail: string | null;
  order: number;
}

// ── EXERCISE LIBRARY (0002) ──────────────────────────────────────────────
/**
 * Reusable exercise definition. `owner_id` is null for ownerless/seeded
 * library entries; `is_public` exposes it beyond the owner. `category`
 * shares BlockType's value set (warmup|strength|conditioning|mobility|other).
 */
export interface Exercise {
  id: UUID;
  owner_id: UUID | null;
  is_public: boolean;
  name: string;
  category: BlockType;
  default_video_url: string | null;
  cues: string | null;
  created_at: ISOTimestamp;
}

/**
 * A single exercise row nested under a program_block (0002). `exercise_id`
 * optionally links back to a reusable `exercises` library entry. The metric
 * columns are text to allow ranges / qualitative values ("8-12", "AMRAP",
 * "RPE 8", "3 mi", "90s").
 */
export interface ProgramExercise {
  id: UUID;
  program_block_id: UUID;
  exercise_id: UUID | null;
  name: string;
  sets: number | null;
  reps: string | null;
  load: string | null;
  distance: string | null;
  time: string | null;
  rest: string | null;
  notes: string | null;
  order: number;
}

// ── PROGRAM ENROLLMENTS (0002) ───────────────────────────────────────────
export type EnrollmentStatus = "active" | "paused" | "done";

/**
 * Which program is "mine" plus the scheduler cursor. At most one `active`
 * enrollment per user (the program that drives Today). `current_day_id` is
 * the cursor into the program's days; null falls back to the lowest-ordered day.
 */
export interface ProgramEnrollment {
  id: UUID;
  user_id: UUID;
  program_id: UUID;
  started_on: ISODate;
  current_day_id: UUID | null;
  status: EnrollmentStatus;
  created_at: ISOTimestamp;
}

// ── SESSION LOGS ─────────────────────────────────────────────────────────
export interface SessionLog {
  id: UUID;
  user_id: UUID;
  program_day_id: UUID | null;
  title: string;
  date: ISODate;
  completed: boolean;
  completed_at: ISOTimestamp | null;
  duration_min: number | null;
  rpe: number | null;
  notes: string | null;
  shared: boolean;
  created_at: ISOTimestamp;
}

export interface BlockCompletion {
  id: UUID;
  session_log_id: UUID;
  label: string;
  type: string | null;
  done: boolean;
  detail: Json | null;
  order: number;
}

// ── BODY & FUEL ──────────────────────────────────────────────────────────
export interface BodyMetric {
  id: UUID;
  user_id: UUID;
  date: ISODate;
  weight: number | null;
  body_fat: number | null;
  waist: number | null;
  extra: Json | null;
}

export interface NutritionLog {
  id: UUID;
  user_id: UUID;
  date: ISODate;
  meal: string | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  created_at: ISOTimestamp;
}

export interface WaterLog {
  id: UUID;
  user_id: UUID;
  date: ISODate;
  ml: number;
}

export interface PR {
  id: UUID;
  user_id: UUID;
  label: string;
  value: number;
  unit: string | null;
  achieved_on: ISODate;
  created_at: ISOTimestamp;
}

// ── SOCIAL ───────────────────────────────────────────────────────────────
export interface FeedPost {
  id: UUID;
  user_id: UUID;
  crew_id: UUID;
  kind: FeedKind;
  ref_id: UUID | null;
  body: string | null;
  created_at: ISOTimestamp;
}

export interface Reaction {
  post_id: UUID;
  user_id: UUID;
  emoji: string;
}

export interface Nudge {
  id: UUID;
  from_user: UUID;
  to_user: UUID;
  crew_id: UUID | null;
  seen: boolean;
  created_at: ISOTimestamp;
}

export interface Badge {
  key: string;
  name: string;
  emoji: string | null;
  description: string | null;
}

export interface UserBadge {
  user_id: UUID;
  badge_key: string;
  earned_on: ISODate;
}

// NOTE: The appearance data model (Appearance / WidgetPref / DEFAULT_APPEARANCE /
// resolveAppearance) intentionally lives in "@/components/ThemeProvider" — that
// is the single source of truth (it owns the live, normalized shape applied to
// <html data-theme/data-accent> and persisted to profiles.appearance). It was
// removed from here (gap 42) to avoid a divergent duplicate. `profiles.appearance`
// is therefore typed as `Json` on the Profile interface above; the (app) layout
// normalizes the raw jsonb via ThemeProvider.normalizeAppearance().
