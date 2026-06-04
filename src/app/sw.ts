/// <reference lib="webworker" />
// ════════════════════════════════════════════════════════════════════
// BASECAMP — Serwist service worker entry
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
// BASECAMP serves per-user data via Server Actions + direct Supabase calls,
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

const runtimeCaching: RuntimeCaching[] = [
  // Network-only for every same-origin /api/* request: responses are never
  // written to Cache Storage. A short network timeout keeps the SW from
  // hanging a request indefinitely (mirrors the original /api/auth rule).
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && pathname.startsWith(API_PREFIX),
    handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
  },
  // Everything else keeps Serwist's recommended defaults, minus the rule that
  // persisted authenticated /api/* GET responses into the "apis" cache.
  ...defaultCache.filter((entry) => {
    const writesToApisCache =
      "cacheName" in entry.handler && entry.handler.cacheName === "apis";
    return !writesToApisCache;
  }),
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

serwist.addEventListeners();
