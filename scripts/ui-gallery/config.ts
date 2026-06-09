/* ════════════════════════════════════════════════════════════════════
   UI GALLERY — configuration knobs.

   Everything you'd tweak lives here: the phone viewports, themes, the
   accounts used for the populated/empty/logged-out passes, and the route
   list (with optional "open this overlay" interaction states). capture.ts
   reads these to drive a real browser over the running app; build-gallery.ts
   turns the resulting manifest into a single static index.html.

   No app code is touched — overlays are reached purely by their accessible
   name / role (the shared <Sheet> renders role="dialog"), and the theme is
   the [data-theme] attribute on <html>.
   ════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";

/* ── .env loader ─────────────────────────────────────────────────────────
   Load scripts/ui-gallery/.env (gitignored) into process.env without adding a
   dotenv dependency. Existing process.env values win, so you can still
   override per-run on the command line. */
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

/* ── Output locations ────────────────────────────────────────────────────
   Repo-root ui-gallery/ (gitignored). The HTML references shots/ relatively
   and inlines the manifest, so index.html opens straight off file:// with no
   server — it still works even when the app itself won't boot. */
export const OUT_DIR = path.resolve(process.cwd(), "ui-gallery");
export const SHOTS_DIR = path.join(OUT_DIR, "shots");
export const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");
export const HTML_PATH = path.join(OUT_DIR, "index.html");

/** Base URL of the running dev app. Defaults to :3001 (local dev convention). */
export const BASE_URL = (
  process.env.GALLERY_BASE_URL || "http://localhost:3001"
).replace(/\/$/, "");

/* ── Viewports — four phones, real device-pixel-ratios ───────────────────── */
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export interface ViewportDef {
  key: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  ua: string;
}

export const VIEWPORTS: ViewportDef[] = [
  { key: "android", label: "Android 360", width: 360, height: 800, dpr: 2, ua: ANDROID_UA },
  { key: "se", label: "iPhone SE 375", width: 375, height: 667, dpr: 2, ua: IOS_UA },
  { key: "i14", label: "iPhone 14 390", width: 390, height: 844, dpr: 3, ua: IOS_UA },
  { key: "s23u", label: "Galaxy S23 Ultra 412", width: 412, height: 915, dpr: 3.5, ua: ANDROID_UA },
];

/* ── Themes ──────────────────────────────────────────────────────────────── */
export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/* ── Accounts (the "data" axis) ──────────────────────────────────────────────
   populated = your real seeded dev account; empty = a throwaway account the
   script signs up on the fly (instant locally, confirmations off) so the
   empty-state of every screen is captured without polluting your real data;
   loggedout = no session (login + landing). */

/** Populated account + the local dev password the tooling sets on it, so the
 *  populated pass needs NO human-entered secret (see provision.ts). Override
 *  either via env (GALLERY_EMAIL / GALLERY_PASSWORD) for a different account. */
export const POPULATED_EMAIL = process.env.GALLERY_EMAIL || "climber@basecamp.dev";
export const POPULATED_PASSWORD = process.env.GALLERY_PASSWORD || "pathwarden-ui-gallery";

/** Local Supabase Postgres URL — used ONLY to (re)set the populated account's
 *  password via pgcrypto. The provisioner refuses to run against a non-local
 *  host, so this can never touch production. */
export const DB_URL =
  process.env.GALLERY_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type AccountKind = "login" | "signup" | "none";
export interface AccountDef {
  key: string;
  label: string;
  kind: AccountKind;
  email?: string;
  password?: string;
}

export const ACCOUNTS: AccountDef[] = [
  {
    key: "populated",
    label: "Populated",
    kind: "login",
    email: POPULATED_EMAIL,
    password: POPULATED_PASSWORD,
  },
  {
    key: "empty",
    label: "Empty",
    kind: "signup",
    // Fixed creds: first run signs up, later runs sign in. The gallery only
    // OPENS overlays (never submits), so this account stays genuinely empty.
    email: process.env.GALLERY_EMPTY_EMAIL || "gallery-empty@basecamp.dev",
    password: process.env.GALLERY_EMPTY_PASSWORD || "gallery-empty-pw-2401",
  },
  { key: "loggedout", label: "Logged out", kind: "none" },
];

/* ── Interaction-state triggers ──────────────────────────────────────────────
   A state opens an overlay by trying each trigger in order until one makes a
   [role="dialog"] appear; missing triggers are skipped (no failure). `label`
   matches aria-label exactly; `name` is a case-insensitive accessible-name
   regex (stored as a string so the config stays plain data). */
export type Trigger = { by: "label"; value: string } | { by: "name"; value: string };
const L = (value: string): Trigger => ({ by: "label", value });
const N = (value: string): Trigger => ({ by: "name", value });

export interface RouteState {
  key: string;
  label: string;
  triggers: Trigger[];
}
const st = (key: string, label: string, triggers: Trigger[]): RouteState => ({
  key,
  label,
  triggers,
});

export type RouteAuth = "user" | "none";
export type DynamicKind = "program" | "programDay";

export interface RouteDef {
  key: string;
  path: string;
  label: string;
  auth: RouteAuth;
  /** Resolved at runtime by following an in-app link (no hardcoded IDs). */
  dynamic?: DynamicKind;
  states?: RouteState[];
}

export const ROUTES: RouteDef[] = [
  // Logged-out
  { key: "landing", path: "/", label: "Landing", auth: "none" },
  { key: "login", path: "/login", label: "Login", auth: "none" },

  // Authenticated app
  {
    key: "today",
    path: "/today",
    label: "Today",
    auth: "user",
    states: [st("quicklog", "Quick-Log open", [L("Quick log")])],
  },
  {
    key: "trackers",
    path: "/trackers",
    label: "Trackers",
    auth: "user",
    // pill header button (aria-label, only when trackers exist) OR the
    // empty-state "Create Your First Tracker" CTA.
    states: [st("new", "New-tracker sheet", [L("New tracker"), N("new tracker"), N("first tracker")])],
  },
  {
    key: "exercises",
    path: "/exercises",
    label: "Exercises",
    auth: "user",
    states: [st("new", "New-exercise sheet", [N("new exercise"), N("add.*exercise"), N("^new$")])],
  },
  {
    key: "programs",
    path: "/programs",
    label: "Programs",
    auth: "user",
    // header "New" button (named just "New"), with broader fallbacks.
    states: [st("new", "New-program sheet", [N("^new$"), N("new program"), N("create program")])],
  },
  { key: "programs-import", path: "/programs/import", label: "Import Program", auth: "user" },
  { key: "program", path: "/programs/[id]", label: "Program detail", auth: "user", dynamic: "program" },
  {
    key: "program-day",
    path: "/programs/[id]/days/[dayId]",
    label: "Program day",
    auth: "user",
    dynamic: "programDay",
  },
  { key: "goals", path: "/goals", label: "Goals", auth: "user" },
  { key: "goals-training", path: "/goals/training", label: "Training schedule", auth: "user" },
  {
    key: "crew",
    path: "/crew",
    label: "Crew",
    auth: "user",
    states: [st("settings", "Crew settings", [L("Crew settings")])],
  },
  { key: "checkin", path: "/checkin", label: "Check-in", auth: "user" },
  { key: "progress", path: "/progress", label: "Progress", auth: "user" },
  { key: "body", path: "/body", label: "Body", auth: "user" },
  { key: "diet", path: "/diet", label: "Diet", auth: "user" },
  { key: "bible", path: "/bible", label: "Bible", auth: "user" },
  { key: "appearance", path: "/appearance", label: "Appearance", auth: "user" },
  { key: "account", path: "/account", label: "Account", auth: "user" },
];

/* ── Tuning ──────────────────────────────────────────────────────────────── */
/** Max browser contexts open at once. */
export const CONCURRENCY = 4;
/** "viewport" = device-screenful (true framing); "fullpage" = whole scroll. */
export type CaptureMode = "viewport" | "fullpage";
