# Phase 1 — Goal-Tracking Foundation

This phase adds a **unified, additive, non-breaking** data + UI foundation for
expanding the fitness PWA into a social goal-tracking app. It does **not** build
the per-type screens (Diet/Bible/Exercise/Custom/Dashboard) — those are Phases
2–6, which plug into the hooks documented at the end of this file.

Migration: `supabase/migrations/0010_goals_foundation.sql`
Types: `src/lib/types.ts` · Reads: `src/lib/queries.ts` · Writes: `src/lib/actions.ts`
Components: `src/components/WeekdayPicker.tsx`, `src/components/WeeklyProgress.tsx`

---

## 1. Product model (locked decisions)

**Four tracker TYPES.** `exercise`, `diet`, `bible` are *first-class singletons*
(at most one per user, enforced by a partial unique index). `custom` can have
many.

**Four CADENCE shapes** (how a weekly target / streak is measured):

| cadence_type        | meaning                                                            | target field           |
|---------------------|-------------------------------------------------------------------|------------------------|
| `times_per_week`    | count toward a weekly # of sessions                               | `weekly_target_count`  |
| `amount_per_week`   | accumulate an amount toward a weekly total, with a custom `unit`  | `weekly_target_amount` |
| `specific_weekdays` | committed weekdays (Mon–Sun); a missed scheduled day breaks streak| `scheduled_weekdays`   |
| `daily_binary`      | did-it / didn't each day + streak                                 | (implicit: 7/week)     |

**Everything is weekly for now.** A `period` column (`'weekly'` default,
`'monthly'` allowed by CHECK) leaves room for monthly with no schema change.

**Social.** All goals are shared with the user's crew by default. There is no
per-goal visibility UI in Phase 1, but a `shared boolean not null default true`
column future-proofs it, and RLS already honors it for crew reads.

---

## 2. Data model

### `public.trackers`

| column                 | type          | notes |
|------------------------|---------------|-------|
| `id`                   | uuid pk       | `gen_random_uuid()` |
| `user_id`              | uuid          | → `profiles(id)` on delete cascade |
| `type`                 | text          | CHECK in (`exercise`,`diet`,`bible`,`custom`) |
| `title`                | text          | required |
| `icon`                 | text null     | emoji / icon key |
| `accent`               | text null     | accent color / theme token |
| `cadence_type`         | text          | CHECK in the 4 shapes |
| `period`               | text          | default `'weekly'`, CHECK in (`weekly`,`monthly`) |
| `weekly_target_count`  | int null      | times_per_week target |
| `weekly_target_amount` | numeric null  | amount_per_week target |
| `unit`                 | text null     | amount_per_week unit label (e.g. `min`, `pages`) |
| `scheduled_weekdays`   | int[] null    | committed weekdays, 0=Sun..6=Sat (Postgres dow); CHECK `<@ {0..6}` |
| `config`               | jsonb         | default `{}`; type-specific settings (see §5) |
| `shared`               | boolean       | default `true` |
| `sort_order`           | int           | default `0` |
| `archived`             | boolean       | default `false` (soft delete) |
| `created_at`           | timestamptz   | default `now()` |

**Indexes**
- `trackers_singleton_per_user` — `UNIQUE (user_id, type) WHERE type <> 'custom'`
  → enforces the exercise/diet/bible singletons; custom is unconstrained.
- `trackers_user_active` — `(user_id, archived, sort_order)` for the active list.

**RLS** (mirrors `session_logs` / `prs` from 0001):
- `trackers_select`: `user_id = auth.uid() OR (shared AND public.shares_crew(user_id))`
- `trackers_write` (ALL): `user_id = auth.uid()` (using + with check)

### `public.tracker_logs`

| column       | type        | notes |
|--------------|-------------|-------|
| `id`         | uuid pk     | |
| `tracker_id` | uuid        | → `trackers(id)` on delete cascade |
| `user_id`    | uuid        | → `profiles(id)`; **denormalized owner**, kept honest by a trigger |
| `date`       | date        | default `current_date` |
| `value`      | numeric     | default `1` (1 = binary/session; the amount for amount_per_week) |
| `note`       | text null   | |
| `created_at` | timestamptz | default `now()` |

`UNIQUE (tracker_id, date)` → one log per day, upsertable.

**Owner-normalization trigger** (`tracker_logs_set_owner`, SECURITY DEFINER,
pinned search_path): on insert/update, `user_id` is forced to the parent
tracker's owner. The client never has to send a correct `user_id`, and a
malicious one is overwritten — so the RLS below is sound even though it keys off
the denormalized column.

**RLS** (mirrors `block_completions` from 0001):
- `tracker_logs_select`: `user_id = auth.uid()` **OR** a crew-mate of a *shared*
  parent tracker (`EXISTS … trackers t WHERE t.id = tracker_id AND t.shared AND
  shares_crew(t.user_id)`).
- `tracker_logs_write` (ALL): `using user_id = auth.uid()`; `with check` requires
  the parent tracker be owned by `auth.uid()` — so you cannot attach a log to
  someone else's tracker.

### Additivity / reuse

This migration **only adds two tables** (+ RLS, indexes, one trigger function).
No existing table is altered or dropped. Diet and Exercise trackers do **not**
duplicate logging — they reuse `nutrition_logs` / `session_logs` and the
`trackers` row just holds config + targets. See the mapping below.

---

## 3. WeeklyProgress — per-type computation mapping

`getWeeklyProgress(tracker, uid?)` in `queries.ts` returns this shape:

```ts
interface WeeklyProgress {
  done: number;                 // progress so far this week
  target: number;               // weekly target (count or amount); 0 if none
  unit: string | null;          // amount unit (e.g. "min"); null otherwise
  perDay: Array<boolean | number>; // 7 entries, Monday-first (idx 0 = Mon)
  streak: number;               // 0 in Phase 1 (richer streaks land per-type)
  scheduledWeekdays: boolean[] | null; // Mon-first; only for specific_weekdays
}
```

Progress is computed from the **right source per type** (week = `weekDates()`,
Monday-first, from `format.ts`):

| type     | progress source                          | `done`                          | `target` source |
|----------|------------------------------------------|---------------------------------|-----------------|
| `bible`  | `tracker_logs`                           | # logged days (or summed value) | tracker cadence fields |
| `custom` | `tracker_logs`                           | # logged days, or summed `value` for amount_per_week | tracker cadence fields |
| `diet`   | `nutrition_logs` (sum of the macro col)  | weekly sum of `config.targetKey` macro (default `kcal`) | `config.weeklyTarget` (or `dailyTarget*7`) |
| `exercise` | `session_logs` where `completed=true`  | # distinct completed days       | `weekly_target_count` (or scheduled-day count) |

Cadence → target resolution (for non-diet types):
- `amount_per_week` → `weekly_target_amount`, `unit` = `tracker.unit`.
- `times_per_week` → `weekly_target_count`.
- `specific_weekdays` → target = number of committed days; `scheduledWeekdays`
  returned as a Mon-first boolean array.
- `daily_binary` → target = 7.

`perDay` is Monday-first to line up with the `WeeklyProgress` strip. A
`dowToMonIndex(dow) = (dow + 6) % 7` helper maps Postgres dow → Mon-first index.

**Streak.** Left at `0` in Phase 1 to keep the foundation light. The DB already
has the canonical weekly/weekday streak algorithm in `recompute_my_stats()`
(0009) for sessions; per-type screens (Phase 2+) should port that pattern to
`tracker_logs` (or call a future `recompute_tracker_streak`).

Helpers:
- `getTrackers(uid?)` → active (non-archived) trackers, ordered by `sort_order`
  then `created_at`.
- `getWeeklyProgress(tracker, uid?)` → the shape above.
- `getTrackersWithProgress(uid?)` → `[{ tracker, progress }]` for a dashboard.

---

## 4. Server actions (`actions.ts`)

All follow the existing `ActionResult<T>` envelope, `requireUser()`, `tooLong()`
length caps, and `revalidatePath("/goals")`. All are RLS-safe (scoped to
`auth.uid()`; DB policies enforce ownership too).

| action | signature | notes |
|--------|-----------|-------|
| `createTracker` | `(input: CreateTrackerInput) => ActionResult<{ id }>` | validates type/cadence/title/unit; `specific_weekdays` requires ≥1 day; translates the singleton `23505` into "You already have a `<type>` tracker". |
| `updateTracker` | `(id, patch: UpdateTrackerInput) => ActionResult` | partial patch; only sends changed fields. |
| `archiveTracker` | `(id, archived = true) => ActionResult` | soft delete / restore. |
| `logTracker` | `(input: LogTrackerInput) => ActionResult` | upsert one `(tracker, date)` log (`onConflict: tracker_id,date`); `value` defaults to 1. |
| `unlogTracker` | `(trackerId, date?) => ActionResult` | delete a day's log (e.g. untick a binary day). |

`CreateTrackerInput`: `{ type, title, cadenceType, icon?, accent?, period?,
weeklyTargetCount?, weeklyTargetAmount?, unit?, scheduledWeekdays?, config?,
shared?, sortOrder? }`. `LogTrackerInput`: `{ trackerId, date?, value?, note? }`.

---

## 5. `config` jsonb contract (per type)

`config` is untyped jsonb so each phase owns its own shape. Current /
recommended keys:

- **diet**: `{ targetKey: "kcal"|"protein"|"carbs"|"fat", dailyTarget?: number,
  weeklyTarget?: number, macros?: { kcal, protein, carbs, fat } }`.
  `getWeeklyProgress` reads `targetKey` (default `kcal`) and
  `weeklyTarget` (or `dailyTarget*7`).
- **bible**: `{ plan?: <plan ref|null> }` — leave room for a future reading plan.
- **exercise**: `{ programRef?: <program/enrollment id> }` — link to the active
  program; progress still comes from `session_logs`.
- **custom**: free-form; nothing read by the foundation today.

---

## 6. Shared UI primitives (`src/components/`)

Both are presentational (no data fetching) and match the app's design tokens.

### `WeekdayPicker.tsx`
7-chip Mon→Sun selector. Controlled.
```ts
<WeekdayPicker value={number[]} onChange={(next: number[]) => …}
  disabled? footer? className? />
```
Values are Postgres dow (0=Sun..6=Sat). Reuses the training-goal day-picker
visual language: active chip `bg-grad text-bg`, inactive `border-line bg-surface
text-muted`, `rounded-[12px]`, uppercase display type.

### `WeeklyProgress.tsx`
Compact weekly visual: a `<Ring>` (done/target %) + a 7-dot Mon→Sun strip.
```ts
<WeeklyProgress data={WeeklyProgressData}
  showCount? showStrip? ringSize? trailing? className? />
```
`WeeklyProgressData` mirrors the `queries.WeeklyProgress` shape (re-declared
locally so the component has no server dependency). Strip dots: `bg-grad` when
filled, `bg-accent2/40` for a scheduled-but-unmet day, `bg-line-solid` otherwise.

---

## 7. Hooks for Phases 2–6

- **Phase 2 — Diet/macros.** Diet screen creates/edits the singleton diet
  tracker; macro targets go in `config` (see §5). Progress already computes from
  `nutrition_logs` via `getWeeklyProgress` — wire the existing meal logging
  (`logMeal`) and read progress; consider per-macro rings.
- **Phase 3 — Bible.** Start with the seeded `bible` tracker (daily_binary or
  specific_weekdays) + `logTracker`. The optional reading plan plugs into
  `config.plan`; `tracker_logs.note`/`value` can record chapters/pages later.
- **Phase 4 — Exercise scheduling.** Use `WeekdayPicker` to set
  `scheduled_weekdays` (cadence `specific_weekdays`) on the exercise tracker;
  link the program via `config.programRef`. Progress reads `session_logs`.
- **Phase 5 — Custom UI.** Full CRUD over custom trackers (all 4 cadence
  shapes), driven by `createTracker`/`updateTracker`/`logTracker`/`archiveTracker`
  + `WeekdayPicker` + `WeeklyProgress`.
- **Phase 6 — Dashboard.** `getTrackersWithProgress(uid)` returns every tracker
  with its weekly progress in one call — render a grid of `WeeklyProgress`.
- **Social phase.** Crew-read RLS is already in place (`shared` + `shares_crew`).
  A future per-goal visibility toggle just flips `trackers.shared` — no migration
  needed. A crew "goals feed" can join `trackers`/`tracker_logs` under the same
  crew-read policy used by `session_logs`/`feed_posts`.
- **Monthly periods.** `period` already accepts `'monthly'`; add monthly windowing
  in `getWeeklyProgress` (or a sibling) and the per-type screens.
- **Streaks.** Port `recompute_my_stats()` (0009) logic to `tracker_logs` for
  per-tracker streaks (the `streak` field is wired through but currently 0).

---

## 8. Verification (local only)

- Migration applied cleanly to `supabase_db_FitnessApp_Claude` (additive; no
  existing data wiped). `\d trackers` / `\d tracker_logs` confirm the schema.
- Seeded for `climber@basecamp.dev`
  (`42160028-dd24-46c9-afa1-51de9f764cac`): a diet tracker (protein macro target
  in config), a bible daily_binary tracker (3 logs this week), and custom
  trackers exercising every cadence — Guitar (amount_per_week min), Cold Shower
  (daily_binary), Mobility (specific_weekdays Mon/Wed/Fri). Seed:
  `/tmp/seed_trackers.sql`.
- Verified: singleton index rejects a 2nd diet tracker; custom allows many; the
  owner-normalization trigger rewrites a spoofed `tracker_logs.user_id`.
- `npx tsc --noEmit` passes.
