/// <reference lib="webworker" />
// ════════════════════════════════════════════════════════════════════
// BASECAMP — Serwist service worker entry
// Compiled by @serwist/next (swSrc "src/app/sw.ts" → swDest "public/sw.js",
// see next.config.mjs). Disabled in development; only emitted on build.
// ════════════════════════════════════════════════════════════════════

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Serwist injects the precache manifest into self.__SW_MANIFEST at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
