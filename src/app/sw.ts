/// <reference lib="webworker" />
// ════════════════════════════════════════════════════════════════════
// Path Warden — Serwist service worker entry
// Compiled by @serwist/next (swSrc "src/app/sw.ts" → swDest "public/sw.js",
// see next.config.mjs). Disabled in development; only emitted on build.
// ════════════════════════════════════════════════════════════════════

import { defaultCache } from "@serwist/next/worker";
import {
  NetworkOnly,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
  Serwist,
} from "serwist";

// Serwist injects the precache manifest into self.__SW_MANIFEST at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// ── Security: never cache authenticated API responses ────────────────
// Serwist's `defaultCache` includes a NetworkFirst rule that writes every
// same-origin GET /api/* response into on-device Cache Storage (the "apis"
// cache). For a per-user app that is a data-leak vector: on a shared or
// borrowed device, a later user (or anyone with DevTools access) could read
// a previous user's cached JSON from Cache Storage even after sign-out,
// because signing out clears the Supabase session but not the SW caches.
//
// Path Warden serves per-user data via Server Actions + direct Supabase calls,
// not same-origin /api/* GET routes, so nothing legitimately needs that
// cache. We harden defense-in-depth here regardless of future routes:
//   1. Drop the cache-writing "apis" rule from defaultCache.
//   2. Prepend a NetworkOnly rule covering ALL of /api/* (not just
//      /api/auth/*). Serwist resolves routes first-match-wins in
//      registration order, so this rule shadows any later caching rule that
//      might otherwise match an /api/* request — making the result safe even
//      if upstream renames the cache and the filter below stops matching.
// Precaching (self.__SW_MANIFEST) is unchanged: it only contains public,
// build-time static assets, never per-user responses.
const API_PREFIX = "/api/";

// Serwist `defaultCache` rules we deliberately drop. Each is also purged from
// Cache Storage on activate (below) so existing installs — which may still hold
// a pre-nonce-fix HTML document under "pages" — recover on first activation
// instead of replaying a stale, CSP-broken page.
const RETIRED_CACHES = [
  // Per-user API responses must never persist to disk (data-leak on shared
  // devices); Path Warden has no cacheable same-origin GET /api/* anyway.
  "apis",
  // HTML documents + RSC payloads carry a per-request CSP nonce that must match
  // the response's CSP header (src/middleware.ts). A cached, replayed document
  // pairs a stale body nonce with a different header nonce and, under
  // 'strict-dynamic', the browser blocks EVERY script on the page.
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  // The SW's fetch() of Google Fonts counts as connect-src, which the CSP does
  // not (and should not) allow — it 's blocked and noisy. Fonts still load
  // normally via the <link rel="stylesheet"> under style-src/font-src.
  "google-fonts-stylesheets",
  "google-fonts-webfonts",
];

const isRetired = (entry: RuntimeCaching) =>
  "cacheName" in entry.handler &&
  RETIRED_CACHES.includes(entry.handler.cacheName as string);

const runtimeCaching: RuntimeCaching[] = [
  // Network-only for every same-origin /api/* request: responses are never
  // written to Cache Storage. A short network timeout keeps the SW from
  // hanging a request indefinitely (mirrors the original /api/auth rule).
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && pathname.startsWith(API_PREFIX),
    handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
  },
  // Network-only for HTML document + RSC navigations. These responses carry a
  // per-request nonce in BOTH the <script> tags and the CSP header; serving
  // them straight from the network keeps the two nonces in lockstep. Caching
  // and replaying a document would desync them and trip 'strict-dynamic',
  // blocking the entire page (the failure that motivated this rule).
  {
    matcher: ({ request, sameOrigin }) =>
      sameOrigin &&
      (request.mode === "navigate" ||
        request.destination === "document" ||
        request.headers.get("RSC") === "1"),
    handler: new NetworkOnly(),
  },
  // Everything else keeps Serwist's recommended defaults, minus the retired
  // caches above (per-user API responses, nonce-bearing documents, fonts).
  ...defaultCache.filter((entry) => !isRetired(entry)),
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

// ── Security: allow the app to purge Cache Storage on sign-out ────────
// signOut() (src/app/auth/signout/route.ts) also sends Clear-Site-Data so
// compliant browsers wipe these caches automatically. This message handler
// is a belt-and-suspenders fallback for clients that don't honor that header
// (or to force a purge without a navigation). It only reacts to our own
// CLEAR_CACHES message, so it composes cleanly with Serwist's built-in
// message handler (which only handles CACHE_URLS).
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
});

// ── Recovery: purge retired runtime caches on activate ───────────────
// skipWaiting + clientsClaim make this SW take control immediately, but Serwist
// only cleans up outdated *precache* entries — not runtime caches. Without this,
// an install upgrading from a version that cached HTML under "pages" would keep
// that stale, nonce-mismatched document on disk. Deleting the retired caches
// here lets every existing client self-heal on the first load of this SW.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all(RETIRED_CACHES.map((name) => caches.delete(name))),
  );
});

serwist.addEventListeners();
