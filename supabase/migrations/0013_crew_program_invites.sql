-- 0013_crew_program_invites.sql — Crew accountability rework + program invites
--
-- Product change: a crew is no longer defined by one shared "weekly sessions
-- per member" quota (crews.weekly_goal stays for backwards compat but the app
-- stops collecting/showing it — each member brings their OWN goals, which are
-- already crew-visible via trackers.shared + getCrewGoals). What's new here is
-- the social piece: a member can invite the crew to a training program through
-- the feed, and any member can accept to get their own editable copy + active
-- enrollment.
--
-- Mechanics:
--   • feed_posts.kind gains 'program_invite' (ref_id = the inviter's program,
--     body = the program name so the feed renders without a cross-user join).
--   • programs.invite_post_id records provenance: "this program was created by
--     accepting that invite post". A partial unique index makes acceptance
--     idempotent per (owner, post) at the DB level.
--   • accept_program_invite(post) is SECURITY DEFINER because the acceptor
--     cannot SELECT the inviter's program under RLS (it is neither public nor
--     theirs) — membership of the post's crew is the authorization instead.
--     The deep copy mirrors clone_program (0002).
--
-- Safe to re-run: constraint dropped by name before re-adding; column/index
-- creation is IF NOT EXISTS; function is CREATE OR REPLACE.

-- ── 1. New feed kind ──────────────────────────────────────────────────
alter table public.feed_posts
  drop constraint if exists feed_posts_kind_check;

alter table public.feed_posts
  add constraint feed_posts_kind_check
  check (kind in ('session', 'pr', 'badge', 'note', 'goal', 'program_invite'));

-- ── 2. Acceptance provenance on programs ──────────────────────────────
alter table public.programs
  add column if not exists invite_post_id uuid
    references public.feed_posts (id) on delete set null;

-- One accepted copy per (owner, invite post): the accept fn is idempotent and
-- this index backstops it against races.
create unique index if not exists programs_invite_accept_once
  on public.programs (owner_id, invite_post_id)
  where invite_post_id is not null;

-- ── 3. Accept an invite: deep-copy the program + return the copy's id ─
create or replace function public.accept_program_invite(p_post uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid         uuid := auth.uid();
  post        record;
  src         record;
  new_program uuid;
  d           record;
  b           record;
  new_day     uuid;
  new_block   uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select id, crew_id, ref_id, kind into post
  from public.feed_posts where id = p_post;
  if post.id is null or post.kind <> 'program_invite' then
    raise exception 'Invite not found';
  end if;
  -- Authorization: the caller must be in the crew the invite was posted to.
  if not public.is_crew_member(post.crew_id) then
    raise exception 'Not a member of this crew';
  end if;

  -- Idempotent: already accepted → hand back the existing copy.
  select id into new_program from public.programs
  where owner_id = uid and invite_post_id = p_post;
  if new_program is not null then
    return new_program;
  end if;

  select * into src from public.programs where id = post.ref_id;
  if src.id is null then
    raise exception 'Program no longer available';
  end if;
  -- The inviter accepting their own invite just uses their original.
  if src.owner_id = uid then
    return src.id;
  end if;

  -- Deep copy (mirrors clone_program, 0002) — name kept as-is, provenance set.
  insert into public.programs (name, source, owner_id, is_public, invite_post_id)
  values (src.name, src.source, uid, false, p_post)
  returning id into new_program;

  for d in select * from public.program_days where program_id = src.id loop
    insert into public.program_days (program_id, phase, week, day, title, est_minutes, video_url, "order")
    values (new_program, d.phase, d.week, d.day, d.title, d.est_minutes, d.video_url, d."order")
    returning id into new_day;

    for b in select * from public.program_blocks where program_day_id = d.id loop
      insert into public.program_blocks (program_day_id, label, type, detail, "order")
      values (new_day, b.label, b.type, b.detail, b."order")
      returning id into new_block;

      insert into public.program_exercises
        (program_block_id, exercise_id, name, sets, reps, load, distance, time, rest, notes, "order")
      select new_block, exercise_id, name, sets, reps, load, distance, time, rest, notes, "order"
      from public.program_exercises where program_block_id = b.id;
    end loop;
  end loop;

  return new_program;
end $$;

revoke all on function public.accept_program_invite(uuid) from public;
grant execute on function public.accept_program_invite(uuid) to authenticated;
