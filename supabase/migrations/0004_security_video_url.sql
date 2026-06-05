-- ════════════════════════════════════════════════════════════════════
-- PATH WARDEN — 0004 security: video_url stored-XSS hardening
--
-- Finding #1 (stored XSS via a javascript: URL in a program day's video_url):
-- The app-layer importers now reject any non-https / non-mtntough.com link
-- (src/lib/format.ts validateVideoUrl + src/lib/url.ts normalizeMtntoughUrl),
-- but clone_program (0002) is SECURITY DEFINER and deep-copies video_url
-- VERBATIM from any public/template program into the cloning user's program.
-- A javascript: video_url planted on a public program would propagate to
-- every user who clones it and execute when they click "Watch on MTNTOUGH".
--
-- This migration closes that path at the database tier (defense-in-depth,
-- independent of the app server) by:
--   1) adding safe_video_url(text) — the SQL mirror of the app's URL check;
--   2) redefining clone_program to sanitize video_url through it on copy;
--   3) neutralizing any already-stored dangerous video_url /
--      default_video_url values that predate these fixes.
-- No RLS policy is changed and no existing control is weakened. clone_program
-- keeps the 0002 convention (SECURITY DEFINER + pinned search_path).
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Canonical server-side URL guard ──────────────────────────────────
-- Returns the input only when it is an https:// URL whose host is exactly
-- 'mtntough.com' or a true subdomain of it (e.g. 'www.mtntough.com');
-- otherwise NULL. Mirrors validateVideoUrl / normalizeMtntoughUrl so the
-- security semantics match the app layer. IMMUTABLE, no side effects;
-- search_path pinned even though it touches no tables (0001/0002 convention).
create or replace function public.safe_video_url(url text)
returns text language plpgsql immutable set search_path = public as $$
declare
  host text;
  rest text;
begin
  if url is null then
    return null;
  end if;
  url := btrim(url);
  if url = '' then
    return null;
  end if;

  -- Require an explicit https:// scheme. This rejects javascript:, data:,
  -- vbscript:, http:, and scheme-relative ("//host") or relative inputs.
  if lower(left(url, 8)) <> 'https://' then
    return null;
  end if;

  -- Authority = everything after https:// up to the first '/', '?' or '#'.
  rest := substring(url from 9);
  host := split_part(split_part(split_part(rest, '/', 1), '?', 1), '#', 1);

  -- Strip userinfo ("user:pass@host") and any :port, then lowercase.
  if position('@' in host) > 0 then
    host := split_part(host, '@', 2);
  end if;
  host := split_part(host, ':', 1);
  host := lower(host);

  if host = 'mtntough.com' or host like '%.mtntough.com' then
    return url;
  end if;
  return null;
end $$;

-- ── 2) Sanitize video_url when cloning a public/template program ─────────
-- Identical to 0002's clone_program except the per-day video_url is passed
-- through safe_video_url() so a dangerous link can never be copied into the
-- caller's own (later-rendered) program. All other behavior is unchanged.
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
    values (new_program, d.phase, d.week, d.day, d.title, d.est_minutes,
            public.safe_video_url(d.video_url), d."order")
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

-- ── 3) Neutralize any already-stored dangerous links ────────────────────
-- Rows written before the app-layer + clone fixes (or seeded directly) may
-- still hold a non-https / non-mtntough.com video_url. Null out anything
-- that fails the guard so it can never render as a dangerous href.
update public.program_days
  set video_url = null
  where video_url is not null
    and public.safe_video_url(video_url) is null;

update public.exercises
  set default_video_url = null
  where default_video_url is not null
    and public.safe_video_url(default_video_url) is null;
