# Path Warden

> The path is narrow. Let's stand watch together.

Path Warden is a mobile-first **Next.js 15 (App Router) + TypeScript + Tailwind +
Supabase** PWA for MTNTOUGH-style training-program tracking, body & nutrition
logging, and **cooperative** crew accountability (shared goals, a feed,
reactions, and nudges — no competitive ranking).

The interface is dark, earthy, and blaze/moss/gold with condensed Oswald display
type and rounded cards. The visual target lives in
[`design-prototypes/`](design-prototypes/variant-4-basecamp/index.html) — open
that `index.html` in a browser to see the look the app ports.

---

## Tech stack

- **Next.js 15** (App Router, React 19, `output: "standalone"`)
- **TypeScript** (strict), **Tailwind CSS** with a CSS-variable theme-token
  engine (see `src/app/globals.css` + `tailwind.config.ts`)
- **Supabase** (Postgres + Auth + Row-Level Security) via `@supabase/ssr`
- **Serwist** service worker for offline/PWA (`src/app/sw.ts` → `public/sw.js`)
- **pnpm** as the package manager, with a supply-chain cooldown (see below)

---

## Prerequisites

- **Node.js 22** (the Dockerfile and CI target Node 22; `>=20.9.0` works locally)
- **Corepack** (ships with Node) to pin pnpm — no global pnpm install needed
- A **Supabase** project + the **Supabase CLI**
  (`brew install supabase/tap/supabase`, or see the
  [install docs](https://supabase.com/docs/guides/cli))
- _(optional)_ **Docker** + Docker Compose to run the containerized build

---

## Setup

### 1. Configure environment variables

```bash
cp .env.example .env.local
```

Then fill in the values from your Supabase dashboard
(**Project Settings → API**):

| Variable                               | What it is                                                       |
| -------------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://<project-ref>.supabase.co`                             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | New publishable key (`sb_publishable_…`) — preferred            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Legacy anon key — only if you use the old key format instead    |
| `NEXT_PUBLIC_SITE_URL`                 | `http://localhost:3000` in dev; your real origin in production  |

> `NEXT_PUBLIC_*` values are inlined into the client bundle, so they are public
> by design. Never put service-role keys or other secrets behind a
> `NEXT_PUBLIC_` prefix.

### 2. Configure Supabase Auth

In the Supabase dashboard:

1. **Authentication → Providers → Email**: enable **Email**, and turn on
   **magic link** sign-in.
2. **Authentication → URL Configuration**:
   - **Site URL** → `http://localhost:3000` (your `NEXT_PUBLIC_SITE_URL`).
   - **Redirect URLs** → add `http://localhost:3000/auth/callback` and
     `http://localhost:3000/auth/confirm` (and the production equivalents when
     you deploy). These are the App Router route handlers that complete the
     login: `/auth/callback` exchanges the OAuth/PKCE code, and `/auth/confirm`
     verifies the magic-link token.

### 3. Apply the database schema (and optional seed)

Link the CLI to your project, then push the migration:

```bash
supabase link --project-ref <your-project-ref>
pnpm db:push           # applies supabase/migrations/0001_init.sql
```

The schema (`supabase/migrations/0001_init.sql`) creates all tables, the
`handle_new_user` trigger that auto-creates a `profiles` row on signup, and the
full Row-Level Security policy set.

**Optional — seed sample content.** `supabase/seed.sql` adds the badge catalog
and one public MTNTOUGH-style program (**Backcountry Athlete**,
Phase 2 · Week 3 · Day 4 "Lower Body + Ruck"). It is idempotent (fixed UUIDs +
`ON CONFLICT DO NOTHING`). The seed runs automatically on a **local** reset:

```bash
pnpm db:reset          # local DB only: re-applies migrations + runs seed.sql
```

To load the seed into a linked **remote** project instead, run it directly, e.g.
`psql "$DATABASE_URL" -f supabase/seed.sql`. Crews, members, and per-user logs
are **not** seeded — they are created in-app.

### 4. Install dependencies and run

```bash
corepack use pnpm@10.18.0   # pins the pnpm version from package.json
pnpm install
pnpm dev                    # http://localhost:3000
```

Open `http://localhost:3000` — unauthenticated visitors are redirected to
`/login`; after a magic-link sign-in you land on `/today`.

---

## Scripts

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Start the Next.js dev server                       |
| `pnpm build`      | Production build (`.next/standalone`)              |
| `pnpm start`      | Run the production build                           |
| `pnpm lint`       | ESLint (`eslint-config-next`)                      |
| `pnpm typecheck`  | `tsc --noEmit`                                     |
| `pnpm db:push`    | Apply migrations to the linked Supabase project    |
| `pnpm db:reset`   | Reset the local DB (re-migrate + run `seed.sql`)   |

---

## Supply-chain hardening (2-day cooldown)

`pnpm-workspace.yaml` sets **`minimumReleaseAge: 2880`** (minutes = 48 hours).
pnpm (>= 10.16) will never resolve to a package version published less than two
days ago — it picks the newest version that is at least this old. This protects
against freshly-published malicious releases that haven't yet been caught or
yanked. If you ever must bypass the cooldown for a specific package, add its
name to `minimumReleaseAgeExclude`.

Because of this, the **first** `pnpm install` resolves against the cooldown
window; the committed `pnpm-lock.yaml` then locks those choices. Docker builds
use `pnpm install --frozen-lockfile`, so they reproduce the lockfile exactly and
inherit the same cooldown-vetted versions.

---

## Docker

The `Dockerfile` produces a small standalone image; `docker-compose.yml` wires
up build args + runtime env from a `.env` file and maps port `3000`.

```bash
cp .env.example .env        # compose reads .env (note: .env, not .env.local)

# Option A — Compose (build + run):
docker compose up --build

# Option B — plain Docker:
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_…" \
  --build-arg NEXT_PUBLIC_SITE_URL="http://localhost:3000" \
  -t path-warden:latest .
docker run --env-file .env -p 3000:3000 path-warden:latest
```

> The `NEXT_PUBLIC_*` vars must be present at **build** time — Next.js inlines
> them into the client bundle — which is why Compose passes them as both build
> args and runtime env.

The app is then served at `http://localhost:3000`.

---

## Project structure

```
src/
  app/
    (app)/            # authenticated app shell: today, checkin, crew, body,
                      #   progress, appearance
    auth/             # callback / confirm / signout route handlers
    login/            # magic-link sign-in
    globals.css       # theme-token engine (CSS variables → Tailwind tokens)
    layout.tsx        # root layout, fonts, manifest/theme wiring
    sw.ts             # Serwist service-worker entry (compiled to public/sw.js)
  lib/supabase/       # browser / server / middleware clients
  middleware.ts       # session refresh
public/
  manifest.webmanifest
  icons/              # PWA icons (see public/icons/README.md — add the PNGs)
supabase/
  migrations/0001_init.sql
  seed.sql            # optional sample program + badge catalog
design-prototypes/    # the HTML visual targets this app ports
```

See [`PROJECT-PLAN.md`](PROJECT-PLAN.md) for the product/feature plan.

---

## Path Warden — production cutover

These are the **manual** steps to bring `https://pathwarden.app` live. They can't
be done from this repo — they touch DNS, the droplet, and the hosted Supabase
dashboard. The Supabase project ref is **unchanged** (`swfcomtbjabplzsisazm`) —
this is the same project, just a new public domain.

### 1. DNS + TLS + nginx (the droplet)

- Point **DNS** `A`/`AAAA` records for `pathwarden.app` at the droplet's IP.
- Issue a **TLS cert** for the new host:
  `certbot --nginx -d pathwarden.app` (add `-d www.pathwarden.app` if you serve
  the apex+www).
- Update the **nginx** vhost `server_name` to `pathwarden.app` (rename
  `/etc/nginx/conf.d/fit.timholum.com.conf` → `pathwarden.app.conf`,
  set `server_name pathwarden.app;`), then `nginx -t && systemctl reload nginx`.

### 2. systemd service env

- In the app's `EnvironmentFile` (`/home/fit/app/.env`), set
  `NEXT_PUBLIC_SITE_URL=https://pathwarden.app`.
- `NEXT_PUBLIC_*` is **build-time inlined**, so rebuild locally with the new
  value and redeploy (rebuild → tar standalone+static+public → scp → extract →
  `systemctl restart` the service). Setting it only in `.env` at runtime is not
  enough for the client bundle.

### 3. Supabase Dashboard — URL configuration (project `swfcomtbjabplzsisazm`)

- **Auth → URL Configuration → Site URL** = `https://pathwarden.app`.
- **Redirect URLs** → add:
  - `https://pathwarden.app/auth/callback`
  - `https://pathwarden.app/auth/confirm`

### 4. Supabase Dashboard — Email Templates

The hosted project does **not** read `supabase/config.toml`, so the on-brand
templates must be pasted in by hand:

- **Auth → Email Templates** → for each of **Magic Link, Confirm signup,
  Reset password, Change email, Invite user**, paste the matching template from
  [`supabase/templates/`](supabase/templates/) and set the on-brand subject.
- Make the **Magic Link** template **code-only**: use `{{ .Token }}` and
  **remove** `{{ .ConfirmationURL }}`. A clicked link can be pre-consumed by
  mail scanners, causing `otp_expired` on the user's first click.

### 5. Optional — custom SMTP sender domain

- For deliverability, configure custom SMTP with a `no-reply@pathwarden.app`
  sender (Auth → SMTP Settings), and add the SPF/DKIM records the provider
  gives you to the `pathwarden.app` DNS zone.
