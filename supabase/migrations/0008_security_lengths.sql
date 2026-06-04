-- ════════════════════════════════════════════════════════════════════
-- BASECAMP — 0005 security: free-text length CHECK constraints
--
-- Finding [low] — server actions validated non-empty but never capped length.
-- The anon/publishable key ships to the browser, so an authenticated user can
-- write the tables directly via PostgREST/Realtime under RLS, bypassing the
-- server actions entirely. Without DB-tier bounds a crew-mate could insert an
-- oversized crew-feed note / display_name / session notes / PR label / exercise
-- cues etc. straight into the row (UI flooding for every crew member who loads
-- the feed + storage-cost abuse). React escapes these as text, so this is an
-- integrity/abuse issue, not XSS.
--
-- src/lib/actions.ts now caps each field server-side (the LIMITS table); these
-- CHECK constraints mirror those caps so the direct-table path is bounded too
-- (defense-in-depth). Limits MATCH the action caps, so a server-validated write
-- is always within range and never trips a CHECK. Some fields (exercise cues,
-- program day/block/exercise text) are authored by server actions that live
-- outside actions.ts; the CHECKs below bound their direct-table path regardless.
--
-- Conventions: char_length() (characters, matching String.length used in the
-- action caps) + "col IS NULL OR …" so nullable columns are not rejected;
-- each constraint added via a guarded DO block so the migration is re-runnable.
-- No RLS policy is changed and no existing control is weakened.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  -- profiles.display_name (<=80). avatar_url length is owned by 0004's avatar
  -- hardening track; not duplicated here.
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    alter table public.profiles
      add constraint profiles_display_name_len
      check (char_length(display_name) <= 80);
  end if;

  -- crews.name (<=80)
  if not exists (select 1 from pg_constraint where conname = 'crews_name_len') then
    alter table public.crews
      add constraint crews_name_len
      check (char_length(name) <= 80);
  end if;

  -- session_logs.title (<=200), notes (<=4000)
  if not exists (select 1 from pg_constraint where conname = 'session_logs_title_len') then
    alter table public.session_logs
      add constraint session_logs_title_len
      check (char_length(title) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_logs_notes_len') then
    alter table public.session_logs
      add constraint session_logs_notes_len
      check (notes is null or char_length(notes) <= 4000);
  end if;

  -- block_completions.label (<=200)
  if not exists (select 1 from pg_constraint where conname = 'block_completions_label_len') then
    alter table public.block_completions
      add constraint block_completions_label_len
      check (char_length(label) <= 200);
  end if;

  -- prs.label (<=120), unit (<=24)
  if not exists (select 1 from pg_constraint where conname = 'prs_label_len') then
    alter table public.prs
      add constraint prs_label_len
      check (char_length(label) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prs_unit_len') then
    alter table public.prs
      add constraint prs_unit_len
      check (unit is null or char_length(unit) <= 24);
  end if;

  -- nutrition_logs.meal (<=120)
  if not exists (select 1 from pg_constraint where conname = 'nutrition_logs_meal_len') then
    alter table public.nutrition_logs
      add constraint nutrition_logs_meal_len
      check (meal is null or char_length(meal) <= 120);
  end if;

  -- feed_posts.body (<=280, mirrors the crew-note textarea maxLength). This is
  -- the core finding: the shared-feed note an attacker could flood.
  if not exists (select 1 from pg_constraint where conname = 'feed_posts_body_len') then
    alter table public.feed_posts
      add constraint feed_posts_body_len
      check (body is null or char_length(body) <= 280);
  end if;

  -- exercises.name (<=120), cues (<=4000). Authored via the exercises server
  -- action (src/app/(app)/exercises/page.tsx); these bound the direct-table path
  -- the finding calls out for exercise cues.
  if not exists (select 1 from pg_constraint where conname = 'exercises_name_len') then
    alter table public.exercises
      add constraint exercises_name_len
      check (char_length(name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercises_cues_len') then
    alter table public.exercises
      add constraint exercises_cues_len
      check (cues is null or char_length(cues) <= 4000);
  end if;

  -- program content text (authored via the programs server actions). Titles /
  -- labels short; free-text detail / notes a few KB.
  if not exists (select 1 from pg_constraint where conname = 'program_days_title_len') then
    alter table public.program_days
      add constraint program_days_title_len
      check (char_length(title) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_blocks_label_len') then
    alter table public.program_blocks
      add constraint program_blocks_label_len
      check (char_length(label) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_blocks_detail_len') then
    alter table public.program_blocks
      add constraint program_blocks_detail_len
      check (detail is null or char_length(detail) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_exercises_name_len') then
    alter table public.program_exercises
      add constraint program_exercises_name_len
      check (char_length(name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_exercises_notes_len') then
    alter table public.program_exercises
      add constraint program_exercises_notes_len
      check (notes is null or char_length(notes) <= 4000);
  end if;
end $$;
