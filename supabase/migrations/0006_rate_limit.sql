-- ════════════════════════════════════════════════════════════════════
-- BASECAMP — 0006 nudge rate limiting (Finding 1, abuse / harassment)
-- Closes the server-side half of the auth/abuse finding for nudges. The
-- auth-call throttle (sign-in / sign-up / magic link) is handled outside SQL:
--   • Supabase dashboard → Auth → Rate Limits (per-IP + per-email caps), and
--   • the Turnstile captcha now wired into src/app/login/page.tsx
--     (NEXT_PUBLIC_TURNSTILE_SITE_KEY) + Auth → Settings "Enable Captcha".
-- Those are configuration/app changes, not migrations.
--
-- Here we make nudges() un-spammable directly at the table, so a malicious
-- crew-mate (threat model C) using the publishable key can't bypass the
-- server action's check:
--   (1) collapse duplicate UNSEEN nudges to the same target (no stacking), and
--   (2) cap the number of nudges from one sender to one target per time window
--       via the RLS WITH CHECK (enforced even on a raw PATCH/POST to /rest/v1).
--
-- All prior controls are preserved. The policy below is a SUPERSET of the
-- 0003 nudges_insert policy (from_user = self, shares a crew, crew_id binding):
-- it keeps every clause and only ADDS the throttle, so legitimate nudging and
-- the cooperative-crew model are unchanged.
-- ════════════════════════════════════════════════════════════════════

-- Tunable throttle parameters (kept in one place so the policy + any future
-- callers read the same numbers). IMMUTABLE so the planner can inline them and
-- they're usable inside the RLS WITH CHECK expression.
create or replace function public.nudge_rate_window()
returns interval language sql immutable set search_path = public as $$
  select interval '10 minutes';
$$;

create or replace function public.nudge_rate_max()
returns int language sql immutable set search_path = public as $$
  select 5;  -- at most 5 nudges from one sender to one target per window
$$;

-- ── (1) Collapse duplicate UNSEEN nudges ────────────────────────────────────
-- A single outstanding (unseen) nudge per (from_user → to_user) pair. Once the
-- recipient marks it seen (markNudgesSeen flips seen=true), the row drops out
-- of this partial index and a fresh nudge is allowed again. This both prevents
-- notification stacking and bounds table growth from a hammering sender.
-- crew_id is intentionally NOT part of the key: "you already nudged this person
-- and they haven't looked yet" holds regardless of which crew tagged it.
create unique index if not exists nudges_one_unseen_per_pair
  on public.nudges (from_user, to_user)
  where seen = false;

-- ── (2) Per-sender → per-target rate cap (RLS WITH CHECK) ────────────────────
-- Rebuild the insert policy as 0003's policy + a window count. The new row is
-- not visible to its own WITH CHECK subquery, so counting EXISTING rows in the
-- window and requiring (< max) admits the Nth send and rejects the (max+1)-th.
-- A SECURITY DEFINER helper does the count so the check is evaluated against
-- the full table (not just the caller's RLS-visible slice) and can't be
-- dodged by a policy interaction; search_path is pinned as elsewhere.
create or replace function public.nudge_count_recent(p_from uuid, p_to uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int
  from public.nudges
  where from_user = p_from
    and to_user   = p_to
    and created_at > now() - public.nudge_rate_window();
$$;
revoke all on function public.nudge_count_recent(uuid, uuid) from public;
grant execute on function public.nudge_count_recent(uuid, uuid) to anon, authenticated;

drop policy if exists nudges_insert on public.nudges;
create policy nudges_insert on public.nudges for insert
  with check (
    -- ── preserved from 0003 ──────────────────────────────────────────────
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
    -- ── added in 0006: rate cap per (sender → target) window ─────────────
    and public.nudge_count_recent(nudges.from_user, nudges.to_user)
        < public.nudge_rate_max()
  );
