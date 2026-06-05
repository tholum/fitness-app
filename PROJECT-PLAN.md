# Path Warden — Build Plan

The real app behind the **Path Warden** prototype (`design-prototypes/variant-4-basecamp/`).
SUMMIT palette × FORGE layout · completion-first tracking · cooperative crew.

## Stack (locked)
- **Next.js 15** (App Router) + TypeScript + **Tailwind** (theme-token engine via CSS vars)
- **Supabase** — Postgres + RLS + Auth (email/password **and** magic link) + Realtime + Storage
- **PWA** via `@serwist/next` (installable on Android + desktop)
- **Docker** standalone output → small runtime image
- **pnpm** with `minimumReleaseAge: 2880` (2-day supply-chain cooldown)

## Decisions
- **Auth:** email+password and magic link. Configured in Supabase dashboard (Email provider on).
- **Crew:** cooperative only — shared weekly goal, "X of N trained today", feed, reactions, nudges. **No leaderboard ranking.**
- **MTNTOUGH:** the app deep-links out to mtntough.com videos (`program_days.video_url`); it tracks *that* a session was done. No video hosting/API.
- **DB migrations:** authored in `supabase/migrations/`, applied by the user via Supabase CLI (`supabase link` → `pnpm db:push`).

## Foundation (already in repo)
- `package.json`, `pnpm-workspace.yaml` (cooldown), `.npmrc`, `tsconfig`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`
- `src/app/globals.css` — theme tokens (dark default + light + accent overrides)
- `src/lib/supabase/{client,server,middleware}.ts`, `src/middleware.ts` — auth/session
- `src/app/layout.tsx` — fonts, manifest, viewport
- `Dockerfile`, `.dockerignore`
- `supabase/migrations/0001_init.sql` — full schema + RLS

## To build (the team)
1. **Auth** — `/login` (password + magic link tabs), `/auth/callback`, `/auth/confirm`, sign-out action.
2. **App shell** — authed layout with bottom nav (Today · Crew · [FAB Check-In] · Body · Progress) + gear→Appearance; theme provider that reads `profiles.appearance`.
3. **Screens** (port from the Path Warden prototype, wired to Supabase):
   - **Today** — today's session card (Watch on MTNTOUGH / Check In), rings, crew-today strip.
   - **Check In** — block checklist, optional detail logging, "Share to crew" + Mark Complete (writes `session_logs` + `block_completions`, posts `feed_posts`).
   - **Crew** — weekly goal progress, "X of N trained today", activity feed, reactions, nudges, invite-by-code.
   - **Body & Fuel** — fuel ring, macros, body metrics, meal/water logging.
   - **Progress** — level/XP, sessions-per-week chart, badges.
   - **Appearance** — accent/theme/energy/units toggles + widget order, persisted to `profiles.appearance`.
4. **Data layer** — typed queries/actions per screen; generated DB types (`supabase gen types`).
5. **PWA** — `src/app/sw.ts`, `manifest.webmanifest`, icons.
6. **Seed** — `supabase/seed.sql`: a sample MTNTOUGH-style program + demo crew for local dev.
7. **Docker compose + README** — run instructions, Supabase setup steps, env, cooldown notes.
8. **Verify** — `corepack use pnpm@10.18.0`, `pnpm install`, `pnpm typecheck`, `pnpm build`; fix until green.

## What the user provides
- `.env.local` from `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`
- Supabase dashboard: enable Email auth (+ magic link), set Site URL + redirect URLs
- `supabase link --project-ref <ref>` then `pnpm db:push` to apply the schema
