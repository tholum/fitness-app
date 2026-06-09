/* ════════════════════════════════════════════════════════════════════
   UI GALLERY — capture.

   Drives the real running app with Playwright and screenshots the full
   matrix (account × viewport × route × theme × interaction-state), writes
   ui-gallery/manifest.json + the PNGs, then builds the static index.html.

   Auth is done by driving the login form so the app sets correct
   @supabase/ssr cookies; the session is saved as storageState and reused.
   No application code is touched.

   Usage:
     pnpm ui:shots                      # full matrix
     pnpm ui:shots --smoke              # fast pipeline check (empty acct, no secrets)
     pnpm ui:shots --accounts=empty --viewports=i14 --themes=dark
     pnpm ui:shots --fullpage           # whole-scroll captures
     pnpm ui:shots --headed             # watch it run
   ════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  ACCOUNTS,
  BASE_URL,
  CONCURRENCY,
  HTML_PATH,
  MANIFEST_PATH,
  OUT_DIR,
  ROUTES,
  SHOTS_DIR,
  THEMES,
  VIEWPORTS,
  type AccountDef,
  type CaptureMode,
  type RouteDef,
  type Theme,
  type Trigger,
  type ViewportDef,
} from "./config";
import { buildGalleryFromManifest } from "./build-gallery";
import { ensurePopulatedPassword } from "./provision";

const SETTLE_MS = 400;
const NAV_TIMEOUT = 35_000;

/* ── CLI ─────────────────────────────────────────────────────────────────── */
interface Args {
  smoke: boolean;
  headed: boolean;
  states: boolean;
  mode: CaptureMode;
  accounts: string[] | null;
  viewports: string[] | null;
  themes: string[] | null;
  routes: string[] | null;
}
function parseArgs(argv: string[]): Args {
  const a: Args = {
    smoke: false,
    headed: false,
    states: true,
    mode: "viewport",
    accounts: null,
    viewports: null,
    themes: null,
    routes: null,
  };
  const list = (s: string) => s.split("=")[1]?.split(",").map((x) => x.trim()).filter(Boolean) ?? null;
  for (const arg of argv) {
    if (arg === "--smoke") a.smoke = true;
    else if (arg === "--headed") a.headed = true;
    else if (arg === "--no-states") a.states = false;
    else if (arg === "--fullpage") a.mode = "fullpage";
    else if (arg.startsWith("--mode=")) a.mode = (list(arg)?.[0] as CaptureMode) ?? "viewport";
    else if (arg.startsWith("--accounts=")) a.accounts = list(arg);
    else if (arg.startsWith("--viewports=")) a.viewports = list(arg);
    else if (arg.startsWith("--themes=")) a.themes = list(arg);
    else if (arg.startsWith("--routes=")) a.routes = list(arg);
  }
  if (a.smoke) {
    a.accounts ??= ["empty", "loggedout"];
    a.viewports ??= ["i14"];
    a.themes ??= ["dark"];
    a.routes ??= ["today", "trackers", "progress", "login"];
    a.states = false;
  }
  return a;
}

/* ── Manifest shape (also consumed by build-gallery) ─────────────────────── */
export interface Shot {
  account: string;
  accountLabel: string;
  route: string;
  routeLabel: string;
  path: string;
  state: string;
  stateLabel: string;
  viewport: string;
  viewportLabel: string;
  width: number;
  height: number;
  dpr: number;
  theme: Theme;
  file: string;
}

/* ── Small helpers ───────────────────────────────────────────────────────── */
const log = (m: string) => process.stdout.write(`${m}\n`);

async function assertReachable(url: string): Promise<void> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    // Any HTTP answer (incl. 3xx redirect to /login) proves the server is up.
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `Dev server not reachable at ${url} (${(err as Error).message}).\n` +
        `Start it first:  pnpm dev   (and make sure local Supabase is running),\n` +
        `or point at another origin:  GALLERY_BASE_URL=http://localhost:3000 pnpm ui:shots`,
    );
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function next(): Promise<void> {
    const item = queue.shift();
    if (item === undefined) return;
    await worker(item);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

/* ── Auth ────────────────────────────────────────────────────────────────── */
/** Navigate to /login and wait until the form is hydrated (handlers attached).
 *  The form is client-rendered inside <Suspense>, so a button can be visible
 *  before React wires its onClick — clicking too early is a silent no-op. */
async function gotoLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500); // let hydration attach event handlers
}

async function waitForAuthResult(page: Page): Promise<boolean> {
  // Resolve as soon as EITHER the form navigates off /login (success) or an
  // inline error appears (e.g. expected "invalid credentials" on first run) —
  // no need to burn the full timeout waiting.
  const success = page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const failure = page
    .getByText(/invalid|something went wrong|already registered|rejected|too many|weak|expired|verification/i)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => false)
    .catch(() => false);
  const ok = await Promise.race([success, failure]);
  if (!ok) return false;
  // Confirm the authed shell painted (the global quick-log FAB only exists in it).
  await page.waitForSelector('[aria-label="Quick log"]', { timeout: 10_000 }).catch(() => {});
  return true;
}

async function loginViaForm(page: Page, email: string, password: string): Promise<boolean> {
  await gotoLogin(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  return waitForAuthResult(page);
}

async function signupViaForm(page: Page, email: string, password: string): Promise<boolean> {
  await gotoLogin(page);
  const toggle = page.getByRole("button", { name: /create an account/i });
  const submit = page.getByRole("button", { name: /^create account$/i });
  await toggle.click(); // flip into sign-up mode
  // Confirm the flip took (submit relabels to "Create account"); retry once if
  // the click raced hydration.
  try {
    await submit.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    await toggle.click();
    await submit.waitFor({ state: "visible", timeout: 5_000 });
  }
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await submit.click();
  return waitForAuthResult(page);
}

/** Returns storageState for the account, or undefined for the logged-out pass. */
async function ensureSession(browser: Browser, account: AccountDef) {
  if (account.kind === "none") return undefined;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    let ok = await loginViaForm(page, account.email!, account.password!);
    if (!ok && account.kind === "login") {
      // Hands-off: set the known dev password on the LOCAL account, then retry —
      // so the populated pass never needs a human-entered secret.
      log(`   ↻ ${account.label} login failed — provisioning local dev password…`);
      if (ensurePopulatedPassword(account.email!, account.password!)) {
        ok = await loginViaForm(page, account.email!, account.password!);
      }
    }
    if (!ok && account.kind === "signup") ok = await signupViaForm(page, account.email!, account.password!);
    if (!ok) {
      throw new Error(
        account.kind === "login"
          ? `Login failed for ${account.email} (auto-provisioning didn't help — non-local DB or account missing).`
          : `Could not sign in or sign up the empty account (${account.email}).`,
      );
    }
    return await ctx.storageState();
  } finally {
    await ctx.close();
  }
}

/* ── Dynamic route resolution (follow real in-app links) ─────────────────── */
const UUID_PATH = /^\/programs\/[0-9a-f-]{36}$/i;
const DAY_PATH = /^\/programs\/[0-9a-f-]{36}\/days\/[0-9a-f-]{36}$/i;

async function firstHrefMatching(page: Page, re: RegExp): Promise<string | null> {
  const hrefs = await page
    .locator('a[href^="/programs/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") || ""));
  return hrefs.find((h) => re.test(h)) ?? null;
}

async function resolveDynamicRoutes(browser: Browser, state: Awaited<ReturnType<typeof ensureSession>>) {
  const out: { program: string | null; programDay: string | null } = { program: null, programDay: null };
  if (!state) return out;
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/programs`, { waitUntil: "load", timeout: NAV_TIMEOUT });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    out.program = await firstHrefMatching(page, UUID_PATH);
    if (out.program) {
      await page.goto(`${BASE_URL}${out.program}`, { waitUntil: "load", timeout: NAV_TIMEOUT });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      out.programDay = await firstHrefMatching(page, DAY_PATH);
    }
  } catch {
    /* leave unresolved → those routes are skipped */
  } finally {
    await ctx.close();
  }
  return out;
}

/* ── Page prep + capture ─────────────────────────────────────────────────── */
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  // ThemeProvider re-applies the stored theme once on mount; we set the
  // attribute AFTER load/hydration so this override sticks.
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

async function killAnimations(page: Page): Promise<void> {
  await page
    .addStyleTag({
      content:
        "*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important;caret-color:transparent!important}",
    })
    .catch(() => {});
}

async function expandForFullpage(page: Page): Promise<void> {
  // The app shell is a fixed h-[100dvh] column with an internal scroller
  // (#main). Neutralize it so fullPage captures the whole document.
  await page.addStyleTag({
    content:
      'html,body{height:auto!important;overflow:visible!important}' +
      '#main{height:auto!important;max-height:none!important;overflow:visible!important}' +
      '[class*="100dvh"]{height:auto!important}',
  });
}

/** Navigate with one retry — dev-mode first compilation can occasionally
 *  overrun the load timeout when several routes compile at once. */
async function gotoWithRetry(page: Page, url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
      return true;
    } catch {
      if (attempt === 2) return false;
      await page.waitForTimeout(800); // let the slow compile settle, then retry
    }
  }
  return false;
}

async function openOverlay(page: Page, triggers: Trigger[]): Promise<boolean> {
  for (const t of triggers) {
    const loc =
      t.by === "label"
        ? page.locator(`[aria-label="${t.value}"]`)
        : page.getByRole("button", { name: new RegExp(t.value, "i") });
    if (!(await loc.count().catch(() => 0))) continue;
    try {
      await loc.first().click({ timeout: 2_500 });
      await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 2_500 });
      await page.waitForTimeout(250);
      return true;
    } catch {
      /* try next trigger */
    }
  }
  return false;
}

interface RuntimeRoute extends RouteDef {
  concretePath: string;
}

async function captureContext(
  browser: Browser,
  account: AccountDef,
  state: Awaited<ReturnType<typeof ensureSession>>,
  viewport: ViewportDef,
  routes: RuntimeRoute[],
  themes: Theme[],
  args: Args,
  manifest: Shot[],
): Promise<void> {
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: viewport.ua,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  for (const route of routes) {
    const states = [
      { key: "default", label: "Default", triggers: [] as Trigger[] },
      ...(args.states ? route.states ?? [] : []),
    ];
    for (const theme of themes) {
      for (const s of states) {
        if (!(await gotoWithRetry(page, `${BASE_URL}${route.concretePath}`))) {
          log(`   ! goto failed: ${route.key} (${route.concretePath}) — skipping`);
          continue;
        }
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
        await killAnimations(page);
        if (args.mode === "fullpage") await expandForFullpage(page);
        await page.waitForTimeout(SETTLE_MS); // let hydration's mount effect run...
        await applyTheme(page, theme); // ...then pin the theme so it sticks.
        await page.waitForTimeout(120);

        if (s.key !== "default" && !(await openOverlay(page, s.triggers))) {
          continue; // interaction trigger not present here → skip cleanly
        }

        await page.evaluate(() => (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready).catch(() => {});
        const file = `${account.key}__${route.key}__${s.key}__${viewport.key}__${theme}.png`;
        await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: args.mode === "fullpage" });
        manifest.push({
          account: account.key,
          accountLabel: account.label,
          route: route.key,
          routeLabel: route.label,
          path: route.concretePath,
          state: s.key,
          stateLabel: s.label,
          viewport: viewport.key,
          viewportLabel: viewport.label,
          width: viewport.width,
          height: viewport.height,
          dpr: viewport.dpr,
          theme,
          file: `shots/${file}`,
        });
        log(`   ✓ ${file}`);
      }
    }
  }
  await ctx.close();
}

/* ── Orchestration ───────────────────────────────────────────────────────── */
function selectRoutesForAccount(
  account: AccountDef,
  args: Args,
  dyn: { program: string | null; programDay: string | null },
): RuntimeRoute[] {
  const wantAuth = account.kind === "none" ? "none" : "user";
  return ROUTES.filter((r) => r.auth === wantAuth)
    .filter((r) => !args.routes || args.routes.includes(r.key))
    .map((r): RuntimeRoute | null => {
      if (r.dynamic === "program") return dyn.program ? { ...r, concretePath: dyn.program } : null;
      if (r.dynamic === "programDay") return dyn.programDay ? { ...r, concretePath: dyn.programDay } : null;
      return { ...r, concretePath: r.path };
    })
    .filter((r): r is RuntimeRoute => r !== null);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  log(`\n📸 UI gallery — capturing ${BASE_URL}\n`);

  await assertReachable(BASE_URL);

  // Resolve which accounts/viewports/themes this run covers.
  const accounts = ACCOUNTS.filter((a) => !args.accounts || args.accounts.includes(a.key));
  if (accounts.length === 0) throw new Error("No accounts to capture (check --accounts).");

  const viewports = VIEWPORTS.filter((v) => !args.viewports || args.viewports.includes(v.key));
  const themes = THEMES.filter((t) => !args.themes || args.themes.includes(t)) as Theme[];
  if (viewports.length === 0 || themes.length === 0) throw new Error("No viewports/themes selected.");

  // Fresh output dir on a full run; otherwise keep prior PNGs and overwrite.
  const isFull =
    !args.smoke && !args.accounts && !args.viewports && !args.themes && !args.routes && args.states && args.mode === "viewport";
  if (isFull) fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: !args.headed });
  const manifest: Shot[] = [];
  try {
    // Sessions (login / signup) — reused across every viewport context.
    log("🔑 Establishing sessions...");
    const states = new Map<string, Awaited<ReturnType<typeof ensureSession>>>();
    const liveAccounts: AccountDef[] = [];
    for (const account of accounts) {
      try {
        states.set(account.key, await ensureSession(browser, account));
        liveAccounts.push(account);
        log(`   ✓ ${account.label}`);
      } catch (e) {
        // One pass failing (e.g. populated on a non-local DB) must not kill the rest.
        log(`   ⚠ ${account.label}: ${(e as Error).message} — skipping this pass`);
      }
    }
    if (liveAccounts.length === 0) throw new Error("No sessions could be established.");

    // Dynamic routes — resolved once from whichever logged-in session exists.
    const sessionState = states.get("populated") ?? states.get("empty");
    const dyn = await resolveDynamicRoutes(browser, sessionState);
    log(`🧭 Dynamic routes: program=${dyn.program ?? "—"} day=${dyn.programDay ?? "—"}\n`);

    // One task per (account × viewport); bounded concurrency.
    const tasks = liveAccounts.flatMap((account) =>
      viewports.map((viewport) => ({ account, viewport, routes: selectRoutesForAccount(account, args, dyn) })),
    );
    await runPool(tasks, CONCURRENCY, async ({ account, viewport, routes }) => {
      log(`▶  ${account.label} · ${viewport.label} (${routes.length} routes)`);
      await captureContext(browser, account, states.get(account.key), viewport, routes, themes, args, manifest);
    });
  } finally {
    await browser.close();
  }

  // Persist manifest + build the static gallery. PARTIAL runs (--routes /
  // --accounts / --themes / --viewports filters) merge into the existing
  // manifest instead of replacing it — otherwise a quick one-route recapture
  // would silently drop every other screen from the gallery. Old entries are
  // kept when they weren't recaptured this run and their PNG still exists.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let shots = manifest;
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { shots?: Shot[] };
      const fresh = new Set(manifest.map((s) => s.file));
      const kept = (prev.shots ?? []).filter(
        (s) => !fresh.has(s.file) && fs.existsSync(path.join(OUT_DIR, s.file)),
      );
      shots = [...kept, ...manifest];
    } catch {
      // Corrupt/old manifest — fall back to just this run's shots.
    }
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    baseURL: BASE_URL,
    mode: args.mode,
    count: shots.length,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ meta, shots }, null, 2));
  buildGalleryFromManifest();

  log(`\n✅ ${manifest.length} screenshots → ${path.relative(process.cwd(), OUT_DIR)}/`);
  log(`   Open: file://${HTML_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`\n❌ ${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
});
