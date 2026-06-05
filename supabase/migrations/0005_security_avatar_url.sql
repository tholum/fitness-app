-- ════════════════════════════════════════════════════════════════════
-- PATH WARDEN — 0005 security: avatar_url scheme hardening
--
-- Finding (informational): profiles.avatar_url is stored with no scheme
-- validation and is rendered as `<img src={avatar_url}>` in the owner's own
-- account preview (src/app/(app)/account/_components.tsx). A javascript:/data:
-- URL in an <img src> does not execute script in modern browsers, so this is
-- NOT XSS — but an attacker-controlled value (e.g. an arbitrary external URL,
-- or a non-http scheme) is an unwanted tracking/beacon vector loaded by the
-- owner's browser, and would become a CROSS-USER beacon if avatars are ever
-- surfaced to crew-mates (today crew/today/feed render a generated monogram,
-- not the URL).
--
-- The app layer now rejects any non-https value:
--   • src/lib/actions.ts            → normalizeAvatarUrl() in updateProfile
--   • src/app/(app)/account/...tsx  → safeAvatarUrl() (client mirror; the
--                                     live <img> preview also uses it)
-- This migration closes the SAME hole at the database tier (defense-in-depth,
-- independent of the app server: the row is reachable directly via the
-- anon/publishable key through PostgREST). It:
--   1) adds safe_avatar_url(text) — the SQL mirror of the app's URL check;
--   2) neutralizes any already-stored non-https avatar_url (predating the fix
--      or seeded directly) so the new constraint can be added cleanly and no
--      dangerous value can render;
--   3) adds a CHECK constraint requiring avatar_url to be NULL or https://.
--
-- No RLS policy is changed and no existing control is weakened. NULL avatar_url
-- stays valid (the UI falls back to the monogram), so clearing an avatar and
-- every existing https avatar keep working. The guard is IMMUTABLE with a
-- pinned search_path (0001/0002/0004 convention) so it is safe in a CHECK and
-- cannot be redirected by a caller shadowing `public`.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Canonical server-side URL guard ──────────────────────────────────
-- Returns the input only when it is an https:// URL; otherwise NULL. This
-- rejects javascript:, data:, blob:, vbscript:, http:, and scheme-relative
-- ("//host") or relative inputs. No host allowlist today: avatar_url is only
-- ever rendered for its owner. (If avatars become visible to crew-mates,
-- tighten this to an image-host/CDN allowlist — mirror safe_video_url.)
-- IMMUTABLE, no table access; search_path pinned per the 0001/0002/0004
-- convention.
create or replace function public.safe_avatar_url(url text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if url is null then
    return null;
  end if;
  url := btrim(url);
  if url = '' then
    return null;
  end if;
  -- Require an explicit https:// scheme (case-insensitive on the scheme).
  if lower(left(url, 8)) <> 'https://' then
    return null;
  end if;
  return url;
end $$;

-- ── 2) Neutralize any already-stored non-https avatar links ──────────────
-- Rows written before the app-layer fix (or seeded/inserted directly via the
-- publishable key) may hold a non-https avatar_url. Null those out so the
-- value can never load as a dangerous/beacon src AND so the CHECK below can be
-- added without failing validation against legacy data.
update public.profiles
  set avatar_url = null
  where avatar_url is not null
    and public.safe_avatar_url(avatar_url) is null;

-- ── 3) Enforce the scheme at the database tier ───────────────────────────
-- NULL (cleared avatar) stays allowed; any non-null value must be https://.
-- drop-if-exists first so this migration is re-runnable.
alter table public.profiles
  drop constraint if exists profiles_avatar_url_https;
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or public.safe_avatar_url(avatar_url) is not null);
