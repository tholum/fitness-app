-- ════════════════════════════════════════════════════════════════════
-- PATH WARDEN — seed data
--
-- Loaded after migrations on `supabase db reset` (see supabase/config.toml →
-- [db.seed] sql_paths = ["./seed.sql"]). Safe to re-run: every INSERT uses a
-- fixed UUID / key + ON CONFLICT DO NOTHING, so it is idempotent.
--
-- Seeds only *global, ownerless* content that any athlete can see:
--   • the badge catalog
--   • one public MTNTOUGH-style program (Backcountry Athlete) with the
--     Phase 2 · Week 3 · Day 4 "Lower Body + Ruck" session
--
-- NOTE: crews, crew_members, profiles, and per-user logs are created in-app
-- (profiles are auto-created by the on_auth_user_created trigger; crews are
-- made by users). We intentionally do NOT seed any auth.users / profiles here.
-- The program is published with owner_id = NULL + is_public = true so the
-- programs RLS SELECT policy (is_public OR owner_id = auth.uid()) exposes it.
-- ════════════════════════════════════════════════════════════════════

-- ── BADGES catalog ──────────────────────────────────────────────────────
-- Matches the prototype's badge shelf (variant-4-basecamp): Summit, 14-Day,
-- Rucker, Crew MVP, Iron Lung. World-readable via the badges_select policy.
insert into public.badges (key, name, emoji, description) values
  ('summit',   'Summit',   '🏔️', 'Completed every session in a program phase.'),
  ('streak14', '14-Day',   '🔥', 'Logged a session 14 days in a row.'),
  ('rucker',   'Rucker',   '🎒', 'Finished 10 rucks under load.'),
  ('crew_mvp', 'Crew MVP', '👊', 'Most nudges sent to keep the crew honest.'),
  ('iron_lung','Iron Lung','🫁', 'Crushed a benchmark conditioning effort.')
on conflict (key) do nothing;

-- ── PROGRAM: Backcountry Athlete (MTNTOUGH-style, public) ───────────────
insert into public.programs (id, name, source, owner_id, is_public) values
  ('11111111-1111-4111-8111-111111111111',
   'Backcountry Athlete', 'MTNTOUGH', null, true)
on conflict (id) do nothing;

-- One representative day: Phase 2 · Week 3 · Day 4 — "Lower Body + Ruck".
-- ~58 min total (8 + ~42 + 8). video_url is a deep link back to mtntough.com.
insert into public.program_days
  (id, program_id, phase, week, day, title, est_minutes, video_url, "order")
values
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111',
   2, 3, 4, 'Lower Body + Ruck', 58,
   'https://www.mtntough.com/', 0)
on conflict (id) do nothing;

-- Blocks for that day (type ∈ warmup|strength|conditioning|mobility|other).
insert into public.program_blocks
  (id, program_day_id, label, type, detail, "order")
values
  ('33333333-3333-4333-8333-333333333301',
   '22222222-2222-4222-8222-222222222222',
   'Warm-up', 'warmup', '8 min · dynamic prep', 0),
  ('33333333-3333-4333-8333-333333333302',
   '22222222-2222-4222-8222-222222222222',
   'Strength — Back Squat', 'strength', 'Back Squat 5x5', 1),
  ('33333333-3333-4333-8333-333333333303',
   '22222222-2222-4222-8222-222222222222',
   'Conditioning — Ruck', 'conditioning', 'Ruck 3 mi · 35 lb', 2),
  ('33333333-3333-4333-8333-333333333304',
   '22222222-2222-4222-8222-222222222222',
   'Mobility Flush', 'mobility', '8 min · hips & t-spine', 3)
on conflict (id) do nothing;
