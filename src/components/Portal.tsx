"use client";

/* ════════════════════════════════════════════════════════════════════
   PORTAL — renders children into <body> via React's createPortal.

   Overlays (bottom sheets, dialogs) live in the component tree but must
   paint above the in-flow BottomNav, which is now a normal flex child of
   the (app) shell column. Portaling each overlay to document.body lifts
   it out of the column's stacking context so its z-50 always wins,
   regardless of where the nav sits. SSR-safe: only mounts client-side.
   React context still propagates through portals, so provider-dependent
   sheets (useConfirm, ThemeProvider, etc.) keep working.
   ════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
