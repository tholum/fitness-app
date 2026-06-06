-- 0012_goal_feed_kind.sql — Phase 6 (Social surfacing)
--
-- Additive only. Lets a logged tracker/goal surface in the crew feed by adding
-- a 'goal' value to the feed_posts.kind CHECK. The existing feed model
-- (feed_posts / reactions / nudges) and its RLS (feed_select / feed_insert /
-- feed_delete from 0001) are reused unchanged — a 'goal' post is just another
-- crew-visible row authored by the user, scoped by is_crew_member(crew_id).
--
-- No table is altered structurally; we only widen one CHECK constraint. Safe to
-- re-run: it drops the old constraint by name (if present) before re-adding.

alter table public.feed_posts
  drop constraint if exists feed_posts_kind_check;

alter table public.feed_posts
  add constraint feed_posts_kind_check
  check (kind in ('session', 'pr', 'badge', 'note', 'goal'));
