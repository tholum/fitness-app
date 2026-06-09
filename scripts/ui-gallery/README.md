# UI Gallery

A single page that shows screenshots of **every screen** across phone
resolutions, light/dark, populated vs empty data, and with key overlays open —
for quick UI review. It drives the **real running app** with Playwright (no
component mocking) and emits a self-contained `ui-gallery/index.html` you open
directly.

## One-time setup

```bash
pnpm install                      # installs playwright + tsx (devDeps)
npx playwright install chromium   # downloads the headless browser
```

That's it — **no password or .env needed for local use**:

- **Populated pass**: the tool sets a known dev password (`pathwarden-ui-gallery`)
  on the populated account (`climber@basecamp.dev`) directly in your local
  Supabase via pgcrypto — automatically, on the first run, if login fails. Run
  `pnpm ui:setup` to (re)set it manually (e.g. after a `supabase db reset`).
- **Empty pass**: a throwaway account is auto-signed-up.

Copy `.env.example` → `.env` only if you want to override defaults (account,
port, DB URL). The provisioner refuses to run against any non-local database.

## Run

Start the app + local Supabase first (the gallery shoots the live app):

```bash
pnpm dev            # serves on :3001
# (and your local Supabase stack must be up)
```

Then capture:

```bash
pnpm ui:shots               # full matrix → ui-gallery/index.html
pnpm ui:shots --smoke       # ~20s pipeline check (empty account, no secrets needed)
```

Open `ui-gallery/index.html` in a browser. Use the top bar to switch
data-state / theme / viewports / interaction-states and to search routes; click
any thumbnail for a full-size view.

## Useful flags

| Flag | Effect |
|------|--------|
| `--smoke` | empty + logged-out accounts, one viewport, dark, a few routes |
| `--accounts=empty,loggedout` | limit the data passes (`populated`,`empty`,`loggedout`) |
| `--viewports=se,i14` | limit viewports (keys in `config.ts`) |
| `--themes=dark` | limit themes |
| `--routes=today,trackers` | limit to specific route keys |
| `--no-states` | skip interaction (overlay-open) states |
| `--fullpage` | capture the whole scroll height instead of the device screenful |
| `--headed` | watch the browser run |

`pnpm ui:gallery` rebuilds `index.html` from the existing `manifest.json` without
re-shooting.

## Adding routes or interaction states

Everything is data in [`config.ts`](./config.ts):

- **A new route** → add to `ROUTES` (`auth: "user" | "none"`).
- **An overlay state** → add a `states: [...]` entry; each lists `triggers`
  (`L("aria-label")` or `N("accessible-name-regex")`) tried in order until a
  `[role="dialog"]` appears. Missing triggers are skipped, never fatal.
  **Triggers must only _open_ overlays — never submit** (so the empty account
  stays empty).

## How it works

- **Auth**: drives the login form so the app sets correct `@supabase/ssr`
  cookies; the session is saved as `storageState` and reused. The empty account
  is signed up on the fly (local confirmations are off).
- **Theme**: sets `data-theme` on `<html>` after hydration.
- **Dynamic routes** (`/programs/[id]`, `.../days/[dayId]`): resolved by
  following the first matching in-app link — no hardcoded IDs.
- **Output**: `ui-gallery/` (gitignored) — `shots/*.png` + `manifest.json` +
  `index.html` (manifest inlined, so it works over `file://`).

## Notes

- Default shots are **device-viewport framed** (true per-phone, includes the
  bottom nav). Use `--fullpage` for below-the-fold content.
- It's a point-in-time snapshot — re-run `pnpm ui:shots` to refresh.
