-- ════════════════════════════════════════════════════════════════════
-- PATH WARDEN — initial schema + Row-Level Security
-- Model: solo training-program tracking (completion-first) + cooperative
-- crews (shared goals, feed, reactions, nudges — no competitive ranking).
-- ════════════════════════════════════════════════════════════════════

-- ── EXTENSIONS ──────────────────────────────────────────────────────────
-- pgcrypto provides gen_random_bytes() (used below for crew invite codes).
-- Installed into the dedicated `extensions` schema, matching Supabase's
-- hosted convention. The local stack pre-installs it there too, so this is a
-- no-op locally — but a hosted project has no such guarantee, so we make the
-- dependency explicit. Calls below are schema-qualified so resolution does
-- not depend on the migration session's search_path.
create extension if not exists pgcrypto with schema extensions;

-- ── PROFILES ───────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Athlete',
  avatar_url    text,
  units         text not null default 'imperial' check (units in ('imperial','metric')),
  appearance    jsonb not null default '{}'::jsonb,  -- theme/accent/widgets/etc.
  streak_count  int  not null default 0,
  xp            int  not null default 0,
  level         int  not null default 1,
  created_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Auto-create a profile row whenever an auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── CREWS ───────────────────────────────────────────────────────────────
-- NOTE: crews + crew_members MUST be created before the crew-membership
-- helpers below. Those helpers are LANGUAGE sql, so their bodies are parsed
-- and analyzed at CREATE FUNCTION time (check_function_bodies = on, the
-- Supabase default); the referenced table must already exist or the whole
-- migration aborts on a clean db reset / push.
create table public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique default encode(extensions.gen_random_bytes(4),'hex'),
  weekly_goal int  not null default 4,          -- target sessions/week per member
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);
alter table public.crews enable row level security;

create table public.crew_members (
  crew_id   uuid not null references public.crews (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
alter table public.crew_members enable row level security;

-- ── CREW MEMBERSHIP HELPERS (SECURITY DEFINER → no recursive RLS) ───────
create or replace function public.shares_crew(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.crew_members a
    join public.crew_members b on a.crew_id = b.crew_id
    where a.user_id = auth.uid() and b.user_id = target
  );
$$;

create or replace function public.is_crew_member(c uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.crew_members
    where crew_id = c and user_id = auth.uid()
  );
$$;

-- ── PROGRAM CONTENT (MTNTOUGH plans; uploaded on desktop) ───────────────
create table public.programs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  source     text not null default 'custom',     -- 'MTNTOUGH' | 'custom'
  owner_id   uuid references public.profiles (id) on delete set null,
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.programs enable row level security;

create table public.program_days (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs (id) on delete cascade,
  phase       int  not null default 1,
  week        int  not null default 1,
  day         int  not null default 1,
  title       text not null,
  est_minutes int,
  video_url   text,                               -- deep link to mtntough.com
  "order"     int  not null default 0
);
alter table public.program_days enable row level security;

create table public.program_blocks (
  id              uuid primary key default gen_random_uuid(),
  program_day_id  uuid not null references public.program_days (id) on delete cascade,
  label           text not null,
  type            text not null default 'strength'
                    check (type in ('warmup','strength','conditioning','mobility','other')),
  detail          text,                            -- e.g. "Back Squat 5x5"
  "order"         int not null default 0
);
alter table public.program_blocks enable row level security;

-- ── SESSION LOGS (completion-first) ─────────────────────────────────────
create table public.session_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete set null,
  title          text not null,
  date           date not null default current_date,
  completed      boolean not null default false,
  completed_at   timestamptz,
  duration_min   int,
  rpe            int check (rpe between 1 and 10),
  notes          text,
  shared         boolean not null default true,    -- post to crew feed
  created_at     timestamptz not null default now()
);
alter table public.session_logs enable row level security;

create table public.block_completions (
  id              uuid primary key default gen_random_uuid(),
  session_log_id  uuid not null references public.session_logs (id) on delete cascade,
  label           text not null,
  type            text,
  done            boolean not null default false,
  detail          jsonb,                            -- optional weight/time/etc.
  "order"         int not null default 0
);
alter table public.block_completions enable row level security;

-- ── BODY & FUEL ─────────────────────────────────────────────────────────
create table public.body_metrics (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  date      date not null default current_date,
  weight    numeric,
  body_fat  numeric,
  waist     numeric,
  extra     jsonb,
  unique (user_id, date)
);
alter table public.body_metrics enable row level security;

create table public.nutrition_logs (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  date     date not null default current_date,
  meal     text,
  kcal     int,
  protein  int,
  carbs    int,
  fat      int,
  created_at timestamptz not null default now()
);
alter table public.nutrition_logs enable row level security;

create table public.water_logs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date    date not null default current_date,
  ml      int  not null default 0,
  unique (user_id, date)
);
alter table public.water_logs enable row level security;

create table public.prs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  label        text not null,
  value        numeric not null,
  unit         text,
  achieved_on  date not null default current_date,
  created_at   timestamptz not null default now()
);
alter table public.prs enable row level security;

-- ── SOCIAL: feed, reactions, nudges, badges ─────────────────────────────
create table public.feed_posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  crew_id    uuid not null references public.crews (id) on delete cascade,
  kind       text not null check (kind in ('session','pr','badge','note')),
  ref_id     uuid,
  body       text,
  created_at timestamptz not null default now()
);
alter table public.feed_posts enable row level security;

create table public.reactions (
  post_id uuid not null references public.feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji   text not null,
  primary key (post_id, user_id, emoji)
);
alter table public.reactions enable row level security;

create table public.nudges (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  crew_id    uuid references public.crews (id) on delete cascade,
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.nudges enable row level security;

create table public.badges (
  key         text primary key,
  name        text not null,
  emoji       text,
  description text
);
alter table public.badges enable row level security;

create table public.user_badges (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  badge_key text not null references public.badges (key) on delete cascade,
  earned_on date not null default current_date,
  primary key (user_id, badge_key)
);
alter table public.user_badges enable row level security;

-- ════════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ════════════════════════════════════════════════════════════════════

-- profiles: self full access; crew-mates can read.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_crew(id));
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- crews: members read; creator manages.
create policy crews_select on public.crews for select
  using (public.is_crew_member(id) or created_by = auth.uid());
create policy crews_insert on public.crews for insert
  with check (created_by = auth.uid());
create policy crews_update on public.crews for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy crews_delete on public.crews for delete
  using (created_by = auth.uid());

-- crew_members: members see fellow members; you manage your own membership.
create policy crew_members_select on public.crew_members for select
  using (public.is_crew_member(crew_id));
create policy crew_members_insert on public.crew_members for insert
  with check (user_id = auth.uid());
create policy crew_members_delete on public.crew_members for delete
  using (user_id = auth.uid());

-- programs + content: public or owned; owner writes.
create policy programs_select on public.programs for select
  using (is_public or owner_id = auth.uid());
create policy programs_write on public.programs for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy program_days_select on public.program_days for select
  using (exists (select 1 from public.programs p
    where p.id = program_id and (p.is_public or p.owner_id = auth.uid())));
create policy program_days_write on public.program_days for all
  using (exists (select 1 from public.programs p where p.id = program_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.owner_id = auth.uid()));

create policy program_blocks_select on public.program_blocks for select
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
    where d.id = program_day_id and (p.is_public or p.owner_id = auth.uid())));
create policy program_blocks_write on public.program_blocks for all
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
    where d.id = program_day_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
    where d.id = program_day_id and p.owner_id = auth.uid()));

-- session_logs: own everything; crew-mates can read shared completed logs.
create policy session_logs_select on public.session_logs for select
  using (user_id = auth.uid() or (shared and public.shares_crew(user_id)));
create policy session_logs_write on public.session_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy block_completions_select on public.block_completions for select
  using (exists (select 1 from public.session_logs s where s.id = session_log_id
    and (s.user_id = auth.uid() or (s.shared and public.shares_crew(s.user_id)))));
create policy block_completions_write on public.block_completions for all
  using (exists (select 1 from public.session_logs s where s.id = session_log_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.session_logs s where s.id = session_log_id and s.user_id = auth.uid()));

-- body & nutrition: strictly private.
create policy body_metrics_all on public.body_metrics for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nutrition_logs_all on public.nutrition_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy water_logs_all on public.water_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PRs: own + crew-mates can read (for the feed/celebrations).
create policy prs_select on public.prs for select
  using (user_id = auth.uid() or public.shares_crew(user_id));
create policy prs_write on public.prs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- feed: visible to crew members; author posts to crews they belong to.
create policy feed_select on public.feed_posts for select
  using (public.is_crew_member(crew_id));
create policy feed_insert on public.feed_posts for insert
  with check (user_id = auth.uid() and public.is_crew_member(crew_id));
create policy feed_delete on public.feed_posts for delete
  using (user_id = auth.uid());

-- reactions: visible/writable within the post's crew.
create policy reactions_select on public.reactions for select
  using (exists (select 1 from public.feed_posts p where p.id = post_id and public.is_crew_member(p.crew_id)));
create policy reactions_insert on public.reactions for insert
  with check (user_id = auth.uid()
    and exists (select 1 from public.feed_posts p where p.id = post_id and public.is_crew_member(p.crew_id)));
create policy reactions_delete on public.reactions for delete
  using (user_id = auth.uid());

-- nudges: sender & recipient can see; sender must share a crew with recipient.
create policy nudges_select on public.nudges for select
  using (to_user = auth.uid() or from_user = auth.uid());
create policy nudges_insert on public.nudges for insert
  with check (from_user = auth.uid() and public.shares_crew(to_user));
-- recipient may flip `seen`, but cannot rewrite from_user/crew_id (only `seen`
-- is mutable). markNudgesSeen only ever sets seen=true, so this is unaffected.
create policy nudges_update on public.nudges for update
  using (to_user = auth.uid())
  with check (
    to_user = auth.uid()
    and from_user = (select n.from_user from public.nudges n where n.id = id)
    and crew_id is not distinct from (select n.crew_id from public.nudges n where n.id = id)
  );
-- cleanup: either party may delete a nudge (recipient dismiss / sender retract).
create policy nudges_delete on public.nudges for delete
  using (to_user = auth.uid() or from_user = auth.uid());

-- badges catalog: world-readable. user_badges: own + crew-mates.
create policy badges_select on public.badges for select using (true);
create policy user_badges_select on public.user_badges for select
  using (user_id = auth.uid() or public.shares_crew(user_id));
create policy user_badges_write on public.user_badges for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Helpful indexes ─────────────────────────────────────────────────────
create index on public.crew_members (user_id);
create index on public.session_logs (user_id, date);
create index on public.feed_posts (crew_id, created_at desc);
create index on public.body_metrics (user_id, date desc);
create index on public.nutrition_logs (user_id, date);
