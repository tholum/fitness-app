-- ════════════════════════════════════════════════════════════════════
-- 0011_exercise_schedule_sync.sql
-- PHASE 4 — EXERCISE WEEKDAY SCHEDULING.
--
-- The user already picks WHICH weekdays they train via the 0009 training goal
-- (profiles.goal_type / training_days / weekly_target), and that schedule drives
-- the session streak in recompute_my_stats(). That stays the single SOURCE OF
-- TRUTH for the exercise schedule — Phase 4 does NOT introduce a second place to
-- store weekdays.
--
-- What this migration adds is a one-way SYNC: it mirrors the profile training
-- goal into the user's singleton `exercise` tracker (0010) so the unified
-- dashboard (Phase 6) can render exercise weekly progress via getWeeklyProgress
-- — which reads session_logs but takes its cadence/target/scheduled-weekdays
-- from the tracker row. The mapping is:
--
--   profiles.goal_type = 'days'  →  exercise.cadence_type = 'specific_weekdays'
--                                   exercise.scheduled_weekdays = training_days
--                                   exercise.weekly_target_count = #training_days
--   profiles.goal_type = 'count' →  exercise.cadence_type = 'times_per_week'
--                                   exercise.scheduled_weekdays = NULL
--                                   exercise.weekly_target_count = weekly_target
--
--   exercise.config.programRef   →  the user's ACTIVE program_enrollments.id
--                                   (Phase 1 §5 contract), or left untouched if
--                                   there is no active enrollment.
--
-- ── ADDITIVE & NON-BREAKING ────────────────────────────────────────────
-- No table is altered or dropped. This only adds two SECURITY DEFINER helper
-- functions and rewrites set_my_training_goal() to call the sync at the end.
-- The recompute_my_stats() streak algorithm (0009) is UNCHANGED — rest days
-- still never break the streak; a missed scheduled day still does.
-- ════════════════════════════════════════════════════════════════════

-- ── sync_my_exercise_tracker ────────────────────────────────────────────────
-- Upsert + reconcile the caller's singleton exercise tracker from their profile
-- training goal. Idempotent: safe to call any number of times. SECURITY DEFINER
-- with a pinned search_path, and ONLY ever touches the caller's own rows.
--
-- If no exercise tracker exists yet, one is created (the 0010 partial unique
-- index guarantees at most one per user). If one exists, its cadence / schedule
-- / target are reconciled; title/icon/accent the user may have customized are
-- left alone. config.programRef is refreshed to the active enrollment when there
-- is one (and never clobbered to null when there isn't).
create or replace function public.sync_my_exercise_tracker()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  v_type     text;
  v_days     smallint[];
  v_target   int;
  v_cadence  text;
  v_weekdays int[];
  v_count    int;
  v_prog     uuid;
  v_id       uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select goal_type, training_days, weekly_target
  into v_type, v_days, v_target
  from public.profiles
  where id = uid;

  -- Mirror the 0009 normalization: an empty schedule means "every day".
  if v_days is null or cardinality(v_days) = 0 then
    v_days := array[0,1,2,3,4,5,6]::smallint[];
  end if;
  v_target := greatest(1, least(7, coalesce(v_target, 3)));

  if v_type = 'count' then
    v_cadence  := 'times_per_week';
    v_weekdays := null;
    v_count    := v_target;
  else
    v_cadence  := 'specific_weekdays';
    v_weekdays := v_days::int[];
    v_count    := cardinality(v_days);
  end if;

  -- The active enrollment id is the exercise tracker's programRef (Phase 1 §5).
  select id into v_prog
  from public.program_enrollments
  where user_id = uid and status = 'active'
  limit 1;

  select id into v_id
  from public.trackers
  where user_id = uid and type = 'exercise' and not archived
  limit 1;

  if v_id is null then
    insert into public.trackers (
      user_id, type, title, icon, accent, cadence_type, period,
      weekly_target_count, scheduled_weekdays, config, shared, sort_order
    ) values (
      uid, 'exercise', 'Exercise', '🏔️', 'blaze', v_cadence, 'weekly',
      v_count, v_weekdays,
      case when v_prog is null then '{}'::jsonb
           else jsonb_build_object('programRef', v_prog) end,
      true, 0
    )
    returning id into v_id;
  else
    update public.trackers
    set cadence_type        = v_cadence,
        scheduled_weekdays  = v_weekdays,
        weekly_target_count = v_count,
        -- Refresh programRef when there is an active enrollment; otherwise keep
        -- whatever was there (don't clobber a known ref on a rest week).
        config = case
                   when v_prog is null then config
                   else coalesce(config, '{}'::jsonb)
                        || jsonb_build_object('programRef', v_prog)
                 end
    where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.sync_my_exercise_tracker() from public;
grant execute on function public.sync_my_exercise_tracker() to authenticated;

-- ── set_my_training_goal (rewrite) ──────────────────────────────────────────
-- Same contract as 0009, with one addition: after persisting the goal and
-- recomputing the streak, it syncs the exercise tracker so the dashboard stays
-- consistent with the schedule the user just chose. Everything else (validation,
-- empty-schedule handling, the recompute call) is identical to 0009.
create or replace function public.set_my_training_goal(
  p_type text,
  p_days smallint[],
  p_target int
) returns void language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  v_days   smallint[];
  v_target smallint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_type not in ('days', 'count') then
    raise exception 'invalid goal_type: %', p_type;
  end if;

  v_days := (
    select coalesce(array_agg(distinct d order by d), '{}')::smallint[]
    from unnest(coalesce(p_days, '{}'::smallint[])) as d
    where d between 0 and 6
  );
  if v_days is null or cardinality(v_days) = 0 then
    if p_type = 'days' then
      raise exception 'Pick at least one training day';
    end if;
    v_days := '{0,1,2,3,4,5,6}';
  end if;

  v_target := least(7, greatest(1, coalesce(p_target, 3)));

  update public.profiles
  set goal_type = p_type,
      training_days = v_days,
      weekly_target = v_target
  where id = uid;

  -- Re-derive streak immediately (0009 semantics, unchanged).
  perform public.recompute_my_stats();

  -- Phase 4: keep the singleton exercise tracker in lock-step with the schedule.
  perform public.sync_my_exercise_tracker();
end $$;

revoke all on function public.set_my_training_goal(text, smallint[], int) from public;
grant execute on function public.set_my_training_goal(text, smallint[], int) to authenticated;
