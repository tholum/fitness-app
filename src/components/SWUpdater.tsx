"use client";

import { useEffect } from "react";

// ════════════════════════════════════════════════════════════════════
// SWUpdater — keep an installed PWA on the freshest deployed code.
// ────────────────────────────────────────────────────────────────────
// The team ships frequently, so a home-screen (installed) instance must
// never get pinned to a stale cached build. This client component is the
// single owner of service-worker registration and update detection
// (serwist's own auto-register is disabled via `register: false` in
// next.config.mjs so the two can't fight).
//
// How freshness is guaranteed:
//   • The SW itself uses skipWaiting + clientsClaim (src/app/sw.ts), so a
//     newly deployed worker activates and takes control immediately — no
//     "close all tabs" wait.
//   • When that new worker takes control, the browser fires
//     `controllerchange`. We reload ONCE (guarded against reload loops) so
//     the page is re-fetched under the new worker → newest HTML/app code.
//   • We proactively poke the browser to look for a new worker:
//       - right after registration (on load),
//       - whenever the tab becomes visible again (a backgrounded installed
//         PWA checks for updates the moment it's reopened),
//       - whenever the network comes back online.
//     Each poke is `registration.update()`, which re-fetches sw.js; if the
//     bytes changed, the install→activate→controllerchange flow above runs.
// ════════════════════════════════════════════════════════════════════
export function SWUpdater() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Disabled in dev (no sw.js is emitted then); also lets us bail safely
    // if serving over plain http where the SW API is unavailable.
    if (process.env.NODE_ENV === "development") {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;

    // Guard against reload loops: once we've triggered a reload for a
    // controller change, don't do it again in this page lifetime.
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Ask the browser to re-check sw.js for a newer version.
    const checkForUpdate = () => {
      registration?.update().catch(() => {
        /* offline / transient — next trigger will retry */
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", checkForUpdate);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        // Kick an immediate check so a tab open after a deploy upgrades now,
        // not only on the next visibility/online event.
        checkForUpdate();
      })
      .catch(() => {
        /* registration failed (unsupported / blocked) — app still works */
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", checkForUpdate);
    };
  }, []);

  return null;
}
