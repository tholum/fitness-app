-- ════════════════════════════════════════════════════════════════════
-- 0009_training_goals.sql
-- Per-user training goal so the streak respects rest days. Two modes:
--   'days'  → specific weekdays (training_days, ints 0=Sun..6=Sat, matching
--             Postgres extract(dow ...)). A SCHEDULED day with no completed
--             session breaks the streak; non-scheduled (rest) days are skipped
--             entirely — they neither count nor break it.
--   'count' → a weekly target (weekly_target sessions/week, ANY days). The
--             streak counts consecutive Mon–Sun weeks that hit the target.
--
-- Default is goal_type='days' with every weekday scheduled, which reproduces
-- the previous "consecutive calendar days" streak exactly — so existing users
-- see no change until they pick a schedule.
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists goal_type text not null default 'days'
    check (goal_type in ('days', 'count')),
  add column if not exists training_days smallint[] not null
    default '{0,1,2,3,4,5,6}',
  add column if not exists weekly_target smallint not null default 3
    check (weekly_target between 1 and 7);

-- training_days may only contain valid weekday numbers (0..6). Empty is allowed
-- at the column level; the setter/recompute treat empty as "every day".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_training_days_dow'
  ) then
    alter table public.profiles
      add constraint profiles_training_days_dow
      check (training_days <@ array[0,1,2,3,4,5,6]::smallint[]);
  end if;
end $$;

-- goal_type / training_days / weekly_target affect the streak, so — like
-- xp/level/streak_count — they are NOT in the authenticated column UPDATE grant
-- (migration 0003). They are written only through this SECURITY DEFINER setter,
-- which validates input, writes only the caller's row, and re-derives stats.
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

  -- Sanitize: distinct, sorted, only 0..6.
  v_days := (
    select coalesce(array_agg(distinct d order by d), '{}')::smallint[]
    from unnest(coalesce(p_days, '{}'::smallint[])) as d
    where d between 0 and 6
  );
  if v_days is null or cardinality(v_days) = 0 then
    if p_type = 'days' then
      raise exception 'Pick at least one training day';
    end if;
    v_days := '{0,1,2,3,4,5,6}';  -- never persist an empty schedule
  end if;

  v_target := least(7, greatest(1, coalesce(p_target, 3)));

  update public.profiles
  set goal_type = p_type,
      training_days = v_days,
      weekly_target = v_target
  where id = uid;

  -- Re-derive streak immediately so the new rule takes effect without waiting
  -- for the next session completion.
  perform public.recompute_my_stats();
end $$;

revoke all on function public.set_my_training_goal(text, smallint[], int) from public;
grant execute on function public.set_my_training_goal(text, smallint[], int) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Rewrite recompute_my_stats() to compute the streak per the user's goal.
-- xp / level are unchanged (xp = 50 * #completed; level rolls at level*250).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.recompute_my_stats()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid          uuid := auth.uid();
  n_completed  int;
  v_xp         int;
  v_level      int := 1;
  v_remaining  int;
  v_streak     int := 0;
  v_type       text;
  v_days       smallint[];
  v_target     int;
  v_cursor     date;
  v_week       date;
  v_this_week  date;
  c            int;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into n_completed
  from public.session_logs
  where user_id = uid and completed;

  v_xp := n_completed * 50;
  v_remaining := v_xp;
  while v_remaining >= v_level * 250 loop
    v_remaining := v_remaining - v_level * 250;
    v_level := v_level + 1;
  end loop;

  select goal_type, training_days, weekly_target
  into v_type, v_days, v_target
  from public.profiles
  where id = uid;

  if v_days is null or cardinality(v_days) = 0 then
    v_days := array[0,1,2,3,4,5,6]::smallint[];
  end if;
  v_target := greatest(1, coalesce(v_target, 3));

  if v_type = 'count' then
    -- Consecutive Mon–Sun weeks meeting the target. The in-progress current
    -- week never breaks the streak: it counts if already met, otherwise it is
    -- skipped (not treated as a miss).
    v_this_week := date_trunc('week', current_date)::date;
    v_week := v_this_week;
    loop
      select count(*) into c
      from public.session_logs
      where user_id = uid and completed
        and date >= v_week and date < v_week + 7;

      if v_week = v_this_week then
        if c >= v_target then
          v_streak := v_streak + 1;
        end if;
        v_week := v_week - 7;
      else
        exit when c < v_target;
        v_streak := v_streak + 1;
        v_week := v_week - 7;
      end if;

      exit when v_week < current_date - 3700;  -- ~10y safety bound
    end loop;
  else
    -- 'days' mode: walk back over SCHEDULED weekdays only, requiring a
    -- completion on each, skipping rest days. An unfinished scheduled today
    -- does not break the streak (anchor steps to the previous scheduled day).
    v_cursor := current_date;
    if extract(dow from v_cursor)::int = any(v_days) then
      if not exists (
        select 1 from public.session_logs
        where user_id = uid and completed and date = v_cursor
      ) then
        v_cursor := v_cursor - 1;
        while not (extract(dow from v_cursor)::int = any(v_days)) loop
          v_cursor := v_cursor - 1;
        end loop;
      end if;
    else
      v_cursor := v_cursor - 1;
      while not (extract(dow from v_cursor)::int = any(v_days)) loop
        v_cursor := v_cursor - 1;
      end loop;
    end if;

    while exists (
      select 1 from public.session_logs
      where user_id = uid and completed and date = v_cursor
    ) loop
      v_streak := v_streak + 1;
      v_cursor := v_cursor - 1;
      while not (extract(dow from v_cursor)::int = any(v_days)) loop
        v_cursor := v_cursor - 1;
      end loop;
    end loop;
  end if;

  update public.profiles
  set xp = v_xp, level = v_level, streak_count = v_streak
  where id = uid;
end $$;
