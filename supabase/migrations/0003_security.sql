-- ════════════════════════════════════════════════════════════════════
-- PATH WARDEN — 0003 security hardening
-- Closes four confirmed RLS / authorization findings. All app behavior and
-- the cooperative-crew model are preserved; every privileged write that used
-- to ride a permissive policy now flows through a SECURITY DEFINER function
-- (matching the 0002 convention: join_crew_by_code / clone_program), so the
-- server actions keep working under the anon/publishable key + user session.
--
--   F1 [critical] crew_members INSERT let any authed user join ANY crew.
--   F2 [medium]   profiles UPDATE was un-column-scoped (self-edit xp/level/
--                 streak_count/active_crew_id).
--   F3 [low]      crew_members INSERT let a user self-assign role='owner'.
--   F4 [info]     nudges INSERT did not bind crew_id to a shared crew.
--
-- search_path is pinned on every new definer function (as in 0001/0002) so a
-- caller cannot shadow `public` to redirect the elevated body.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- F1 + F3 — crew_members: no direct client INSERT; joins/creates only via
-- trusted SECURITY DEFINER functions.
-- ════════════════════════════════════════════════════════════════════
-- Drop the permissive self-insert policy. With RLS enabled and no INSERT
-- policy, default-deny blocks ALL direct client inserts into crew_members
-- (closes the invite-bypass in F1 and the role='owner' spoof in F3 at once).
-- join_crew_by_code() (0002) is SECURITY DEFINER and inserts with a hardcoded
-- role='member' after validating the invite code, so it is unaffected; the
-- owner row is now created by the create_crew() definer fn below.
drop policy if exists crew_members_insert on public.crew_members;

-- Create a crew + its owner membership + repoint the creator's active crew,
-- atomically, as the table owner (bypasses the now-absent INSERT policy).
-- role='owner' is forced server-side and can never be client-selected.
-- crews_insert RLS still required created_by = auth.uid(); we keep the same
-- invariant here (created_by is always the caller).
create or replace function public.create_crew(p_name text, p_weekly_goal int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  new_crew  uuid;
  name_norm text := nullif(btrim(p_name), '');
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if name_norm is null then
    raise exception 'Crew name is required';
  end if;

  insert into public.crews (name, weekly_goal, created_by)
  values (name_norm, coalesce(greatest(1, p_weekly_goal), 4), uid)
  returning id into new_crew;

  -- Creator is the sole owner. on conflict is belt-and-braces (PK is
  -- (crew_id, user_id)); a brand-new crew can't already have the row.
  insert into public.crew_members (crew_id, user_id, role)
  values (new_crew, uid, 'owner')
  on conflict (crew_id, user_id) do nothing;

  -- Point the creator's profile at the new crew (membership now exists, so
  -- the active_crew_id membership trigger below is satisfied).
  update public.profiles set active_crew_id = new_crew where id = uid;

  return new_crew;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- F2 — profiles: lock the gamification + membership columns.
-- ════════════════════════════════════════════════════════════════════
-- (a) Column-level privilege. Supabase grants TABLE-WIDE update to anon /
--     authenticated, and in Postgres a table-level UPDATE implicitly covers
--     every column — so a bare `revoke update (col)` is a no-op while the
--     whole-table grant stands. The correct lock is: revoke the table-level
--     UPDATE, then grant UPDATE back on ONLY the columns the app legitimately
--     self-updates. xp/level/streak_count (plus id/created_at) are intentionally
--     omitted, so a direct PATCH /rest/v1/profiles touching them is rejected by
--     privilege check regardless of the row-level policy; the recompute path
--     uses the SECURITY DEFINER fn below. The granted columns keep
--     updateProfile / saveAppearance / ThemeProvider and the active-crew writes
--     working. (REFERENCES is kept so existing FKs are unaffected.)
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, units, appearance, active_crew_id)
  on public.profiles to authenticated;

-- The recompute path (formerly a direct UPDATE in awardCompletionRewards)
-- now runs here as the table owner, bypassing the revoked column grant.
-- Logic mirrors the previous server-side computation exactly:
--   xp     = 50 * (# completed sessions)
--   level  = roll while xp >= level*250 (cumulative)
--   streak = consecutive distinct completed days ending today (or yesterday)
-- Only ever writes the caller's own row (id = auth.uid()).
create or replace function public.recompute_my_stats()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid          uuid := auth.uid();
  n_completed  int;
  v_xp         int;
  v_level      int := 1;
  v_remaining  int;
  v_streak     int := 0;
  v_cursor     date := current_date;
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

  -- Consecutive-day streak over distinct completed dates. Anchor on today if
  -- trained today, else yesterday, so an unfinished today doesn't zero a live
  -- streak (matches consecutiveDayStreak() in actions.ts).
  if not exists (
    select 1 from public.session_logs
    where user_id = uid and completed and date = v_cursor
  ) then
    v_cursor := v_cursor - 1;
    if not exists (
      select 1 from public.session_logs
      where user_id = uid and completed and date = v_cursor
    ) then
      v_cursor := null;  -- streak stays 0
    end if;
  end if;

  while v_cursor is not null and exists (
    select 1 from public.session_logs
    where user_id = uid and completed and date = v_cursor
  ) loop
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  update public.profiles
  set xp = v_xp, level = v_level, streak_count = v_streak
  where id = uid;
end $$;

-- (b) active_crew_id integrity: a user may only point at a crew they belong
--     to (or clear it). Defense-in-depth — the read paths already re-validate
--     membership, but this blocks the unintended arbitrary write directly.
--     Fires only when active_crew_id actually changes, so unrelated profile
--     updates (display_name, appearance, the gamification recompute) are never
--     gated by it.
create or replace function public.enforce_active_crew_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active_crew_id is distinct from old.active_crew_id
     and new.active_crew_id is not null
     and not exists (
       select 1 from public.crew_members
       where crew_id = new.active_crew_id and user_id = new.id
     ) then
    raise exception 'active_crew_id must reference a crew you belong to';
  end if;
  return new;
end $$;

drop trigger if exists profiles_active_crew_guard on public.profiles;
create trigger profiles_active_crew_guard
  before update of active_crew_id on public.profiles
  for each row execute function public.enforce_active_crew_membership();

-- ════════════════════════════════════════════════════════════════════
-- F4 — nudges: bind crew_id to a crew BOTH parties belong to.
-- ════════════════════════════════════════════════════════════════════
-- Keep the existing constraints (sender is self; sender shares a crew with
-- the recipient) and additionally require that, when a crew_id is tagged, it
-- names a crew the caller is in AND the recipient is in. crew_id may still be
-- null (untagged nudge).
drop policy if exists nudges_insert on public.nudges;
create policy nudges_insert on public.nudges for insert
  with check (
    from_user = auth.uid()
    and public.shares_crew(to_user)
    and (
      crew_id is null
      or (
        public.is_crew_member(crew_id)
        and exists (
          select 1 from public.crew_members m
          where m.crew_id = nudges.crew_id and m.user_id = nudges.to_user
        )
      )
    )
  );
