-- ════════════════════════════════════════════════════════════════════
-- 0010_goals_foundation.sql
-- PHASE 1 (Foundation) of the social goal-tracking expansion.
--
-- Adds a UNIFIED goal/tracker model that later phases build on:
--   • trackers      — one row per goal a user commits to.
--   • tracker_logs  — per-day did-it / amount entries for a tracker.
--
-- Four tracker TYPES:
--   exercise | diet | bible  → "first-class" singletons (one per user)
--   custom                   → many per user
--
-- Four CADENCE shapes (how a weekly target / streak is measured):
--   times_per_week    — count toward a weekly # of sessions
--   amount_per_week   — accumulate an amount toward a weekly total (+ unit)
--   specific_weekdays — committed weekdays; a missed scheduled day breaks streak
--   daily_binary      — did-it / didn't each day + streak
--
-- Everything is WEEKLY for now; a `period` column (default 'weekly') leaves
-- room for a future 'monthly' with no schema break.
--
-- ── ADDITIVE & NON-BREAKING ────────────────────────────────────────────
-- This migration ONLY adds two tables (+ their RLS / indexes). It does NOT
-- alter or drop any existing table. The exercise & diet trackers DO NOT
-- duplicate logging — they reuse the existing logs and just hold config +
-- targets. Weekly progress is COMPUTED from the right source per type:
--
--   type      | progress source                       | target source
--   ----------+---------------------------------------+----------------------------
--   bible     | tracker_logs                          | trackers (cadence fields)
--   custom    | tracker_logs                          | trackers (cadence fields)
--   diet      | nutrition_logs (kcal/protein/…)       | trackers.config macro targets
--   exercise  | session_logs (completed sessions)     | trackers (cadence fields)
--
-- (See docs/expansion/phase-1-foundation.md for the full mapping.)
--
-- RLS matches the existing convention exactly: owner full access via
-- auth.uid(); crew-mates may SELECT (mirrors session_logs / prs, using the
-- 0001 public.shares_crew(user_id) SECURITY DEFINER helper). `shared` is the
-- per-row opt-in (default true) so a future UI can hide a goal from the crew.
-- ════════════════════════════════════════════════════════════════════

-- ── TRACKERS ────────────────────────────────────────────────────────────
create table public.trackers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  type                 text not null
                         check (type in ('exercise','diet','bible','custom')),
  title                text not null,
  icon                 text,                       -- optional emoji / icon key
  accent               text,                       -- optional accent color/token
  cadence_type         text not null
                         check (cadence_type in (
                           'times_per_week',
                           'amount_per_week',
                           'specific_weekdays',
                           'daily_binary'
                         )),
  -- Future-proofing: period defaults to 'weekly'. Add 'monthly' handling in a
  -- later phase WITHOUT a schema change.
  period               text not null default 'weekly'
                         check (period in ('weekly','monthly')),
  -- times_per_week → how many sessions/week (e.g. 3).
  weekly_target_count  int,
  -- amount_per_week → the weekly amount to accumulate (e.g. 120) in `unit`.
  weekly_target_amount numeric,
  -- amount_per_week → the unit label (e.g. 'min', 'pages').
  unit                 text,
  -- specific_weekdays → committed weekdays, 0=Sun..6=Sat (Postgres dow),
  -- matching profiles.training_days from 0009.
  scheduled_weekdays   int[],
  -- type-specific settings: diet macro targets, bible plan ref, exercise
  -- program ref, etc. (see the per-type config contract in the design doc).
  config               jsonb not null default '{}'::jsonb,
  -- social: every goal is shared with the crew by default. No per-goal UI now;
  -- the column lets a future phase add a visibility toggle without a migration.
  shared               boolean not null default true,
  sort_order           int not null default 0,
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),

  -- weekdays may only contain valid Postgres dow values (0..6); null allowed.
  constraint trackers_scheduled_weekdays_dow
    check (scheduled_weekdays is null or scheduled_weekdays <@ array[0,1,2,3,4,5,6])
);
alter table public.trackers enable row level security;

-- Singletons: at most one exercise / diet / bible tracker per user. `custom`
-- is unconstrained (many allowed). Partial unique index = the canonical
-- Postgres way to scope a uniqueness rule to a subset of rows.
create unique index trackers_singleton_per_user
  on public.trackers (user_id, type)
  where type <> 'custom';

create index trackers_user_active
  on public.trackers (user_id, archived, sort_order);

-- trackers RLS: owner full access; crew-mates may read a shared tracker.
-- Mirrors session_logs_select / prs_select (0001) using shares_crew().
create policy trackers_select on public.trackers for select
  using (user_id = auth.uid() or (shared and public.shares_crew(user_id)));
create policy trackers_write on public.trackers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── TRACKER_LOGS ────────────────────────────────────────────────────────
-- One row per (tracker, date). `value` is 1 for a binary "did it" / a single
-- session, or the accumulated amount for amount_per_week. UNIQUE (tracker_id,
-- date) makes a day upsertable (one log per day).
create table public.tracker_logs (
  id          uuid primary key default gen_random_uuid(),
  tracker_id  uuid not null references public.trackers (id) on delete cascade,
  -- Denormalized owner: lets RLS / crew-read avoid a join back to trackers and
  -- mirrors the user_id-on-the-row convention used elsewhere. Kept consistent
  -- with the parent tracker by the trigger below.
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null default current_date,
  value       numeric not null default 1,
  note        text,
  created_at  timestamptz not null default now(),
  unique (tracker_id, date)
);
alter table public.tracker_logs enable row level security;

create index tracker_logs_tracker_date on public.tracker_logs (tracker_id, date);
create index tracker_logs_user_date on public.tracker_logs (user_id, date);

-- Keep tracker_logs.user_id honest: force it to the owner of the parent
-- tracker on insert/update. The client never has to send a correct user_id,
-- and a malicious one is overwritten — so the RLS below is sound even though
-- it keys off the denormalized column. (SECURITY DEFINER + pinned search_path,
-- matching the 0001/0003 convention.)
create or replace function public.tracker_logs_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select t.user_id into new.user_id
  from public.trackers t
  where t.id = new.tracker_id;
  if new.user_id is null then
    raise exception 'tracker_logs.tracker_id % does not reference an existing tracker', new.tracker_id;
  end if;
  return new;
end $$;

create trigger tracker_logs_owner_guard
  before insert or update on public.tracker_logs
  for each row execute function public.tracker_logs_set_owner();

-- tracker_logs RLS: owner full access; crew-mates may read logs of a shared
-- tracker. The crew-read predicate joins to the parent tracker and reuses its
-- `shared` flag + shares_crew(), mirroring block_completions_select (0001).
create policy tracker_logs_select on public.tracker_logs for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trackers t
      where t.id = tracker_id
        and t.shared
        and public.shares_crew(t.user_id)
    )
  );
-- Writes: owner only. WITH CHECK keys off the parent tracker's owner (the
-- trigger has already normalized user_id to that owner), so a caller cannot
-- attach a log to someone else's tracker.
create policy tracker_logs_write on public.tracker_logs for all
  using (user_id = auth.uid())
  with check (
    exists (
      select 1 from public.trackers t
      where t.id = tracker_id and t.user_id = auth.uid()
    )
  );
