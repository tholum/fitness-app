-- ════════════════════════════════════════════════════════════════════
-- BASECAMP — 0002 features: program authoring, exercise library,
-- per-exercise detail, enrollment/scheduler, crew lifecycle helpers,
-- and an active-crew pointer. Consistent with 0001 RLS conventions:
--   • owner-writes (owner_id = auth.uid())
--   • public-or-owned reads for program content
--   • strictly-private body/nutrition (unchanged here)
--   • crew helpers via SECURITY DEFINER to avoid recursive RLS
-- ════════════════════════════════════════════════════════════════════

-- ── PROFILES: active-crew pointer (multi-crew switching) ────────────────
-- Nullable FK; on_delete set null so deleting a crew doesn't orphan it.
alter table public.profiles
  add column if not exists active_crew_id uuid references public.crews (id) on delete set null;

-- ════════════════════════════════════════════════════════════════════
-- EXERCISE LIBRARY (reusable; define once, reference from program rows)
-- ════════════════════════════════════════════════════════════════════
create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references public.profiles (id) on delete cascade,
  is_public         boolean not null default false,
  name              text not null,
  category          text not null default 'strength'
                      check (category in ('warmup','strength','conditioning','mobility','other')),
  default_video_url text,
  cues              text,
  created_at        timestamptz not null default now()
);
alter table public.exercises enable row level security;

-- public or owned readable; owner writes (mirrors programs_select/_write).
create policy exercises_select on public.exercises for select
  using (is_public or owner_id = auth.uid());
create policy exercises_write on public.exercises for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- PROGRAM EXERCISES (per-exercise rows nested under a program_block)
-- An "exercise" in a day = one program_exercises row; exercise_id is an
-- optional link back to the reusable library entry.
-- ════════════════════════════════════════════════════════════════════
create table public.program_exercises (
  id               uuid primary key default gen_random_uuid(),
  program_block_id uuid not null references public.program_blocks (id) on delete cascade,
  exercise_id      uuid references public.exercises (id) on delete set null,
  name             text not null,
  sets             int,
  reps             text,         -- text to allow "5", "8-12", "AMRAP"
  load             text,         -- e.g. "185 lb", "BW", "RPE 8"
  distance         text,         -- e.g. "3 mi"
  time             text,         -- e.g. "8 min"
  rest             text,         -- e.g. "90s"
  notes            text,
  "order"          int not null default 0
);
alter table public.program_exercises enable row level security;

-- Readable/writable following the full parent chain to programs ownership,
-- mirroring program_blocks_select / program_blocks_write.
create policy program_exercises_select on public.program_exercises for select
  using (exists (
    select 1 from public.program_blocks b
    join public.program_days d on d.id = b.program_day_id
    join public.programs p on p.id = d.program_id
    where b.id = program_block_id and (p.is_public or p.owner_id = auth.uid())));
create policy program_exercises_write on public.program_exercises for all
  using (exists (
    select 1 from public.program_blocks b
    join public.program_days d on d.id = b.program_day_id
    join public.programs p on p.id = d.program_id
    where b.id = program_block_id and p.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.program_blocks b
    join public.program_days d on d.id = b.program_day_id
    join public.programs p on p.id = d.program_id
    where b.id = program_block_id and p.owner_id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════
-- PROGRAM ENROLLMENTS (which program is "mine" + scheduler cursor)
-- ════════════════════════════════════════════════════════════════════
create table public.program_enrollments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  program_id     uuid not null references public.programs (id) on delete cascade,
  started_on     date not null default current_date,
  current_day_id uuid references public.program_days (id) on delete set null,
  status         text not null default 'active' check (status in ('active','paused','done')),
  created_at     timestamptz not null default now(),
  unique (user_id, program_id)
);
alter table public.program_enrollments enable row level security;

-- At most one ACTIVE enrollment per user (the program that drives Today).
create unique index program_enrollments_one_active
  on public.program_enrollments (user_id) where (status = 'active');

-- Strictly self-scoped (mirrors body/nutrition all-self policies).
create policy program_enrollments_all on public.program_enrollments for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- CREW LIFECYCLE: join-by-code + owner member management
-- ════════════════════════════════════════════════════════════════════

-- crews_select hides crews you're not in, so a client cannot resolve a
-- crew_id from an invite code. This SECURITY DEFINER fn looks it up with
-- elevated rights and inserts the caller as a member, returning crew_id.
create or replace function public.join_crew_by_code(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select id into target from public.crews where invite_code = lower(trim(code));
  if target is null then
    raise exception 'No crew found for that code';
  end if;
  insert into public.crew_members (crew_id, user_id, role)
  values (target, auth.uid(), 'member')
  on conflict (crew_id, user_id) do nothing;
  return target;
end $$;

-- Deep-copy a public/template program (with its days, blocks, exercises)
-- into a new program owned by the caller, so users can fork & edit the
-- ownerless seeded MTNTOUGH plan (whose owner_id is NULL and thus locked).
create or replace function public.clone_program(src uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_program uuid;
  d record;
  b record;
  new_day uuid;
  new_block uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  -- Only clone programs the caller is allowed to see (public or owned).
  if not exists (select 1 from public.programs p
                 where p.id = src and (p.is_public or p.owner_id = auth.uid())) then
    raise exception 'Program not found';
  end if;

  insert into public.programs (name, source, owner_id, is_public)
  select name || ' (copy)', source, auth.uid(), false
  from public.programs where id = src
  returning id into new_program;

  for d in select * from public.program_days where program_id = src loop
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

-- Owner-scoped member management (gap 24). 0001 only allowed self-delete
-- of membership; let the crew creator update roles and remove members.
create policy crew_members_owner_update on public.crew_members for update
  using (exists (select 1 from public.crews c where c.id = crew_id and c.created_by = auth.uid()))
  with check (exists (select 1 from public.crews c where c.id = crew_id and c.created_by = auth.uid()));
create policy crew_members_owner_delete on public.crew_members for delete
  using (exists (select 1 from public.crews c where c.id = crew_id and c.created_by = auth.uid()));

-- ── Indexes ─────────────────────────────────────────────────────────────
create index on public.exercises (owner_id);
create index on public.program_exercises (program_block_id, "order");
create index on public.program_enrollments (user_id, status);
create index on public.program_days (program_id, phase, week, day, "order");
create index on public.program_blocks (program_day_id, "order");
