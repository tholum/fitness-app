"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Appearance,
  type ThemeMode,
  type Accent,
  type Units,
  DEFAULT_APPEARANCE,
  featureFlagAttrs,
  FEATURE_FLAG_NAMES,
  resolveTheme,
} from "@/components/appearance";

/* ════════════════════════════════════════════════════════════════════
   THEME PROVIDER
   Holds the user's appearance preferences (stored in profiles.appearance
   as JSON). Mutations update the live <html data-theme / data-accent>
   attributes immediately and persist to Supabase in the background.

   The pure helpers + types (Appearance, normalizeAppearance,
   featureFlagScript, DEFAULT_APPEARANCE, …) live in ./appearance so server
   components can call them. They are re-exported here for the client
   components that already import them from this module.
   ════════════════════════════════════════════════════════════════════ */

export {
  type Appearance,
  type ThemeMode,
  type Accent,
  type Energy,
  type Units,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  featureFlagAttrs,
  featureFlagScript,
} from "@/components/appearance";

interface ThemeContextValue {
  appearance: Appearance;
  /** Patch one or more appearance fields (optimistic + persisted). */
  setAppearance: (patch: Partial<Appearance>) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  setUnits: (units: Units) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Authed user id — required to persist appearance to their profile. */
  userId: string;
  /** Initial appearance read server-side from profiles.appearance. */
  initial: Appearance;
  children: ReactNode;
}

export function ThemeProvider({ userId, initial, children }: ThemeProviderProps) {
  const [appearance, setAppearanceState] = useState<Appearance>(initial);

  /** Apply theme + accent + feature flags to the root so every token
   *  re-skins and the [data-*="off"] feature gates take effect live. */
  const applyToDom = useCallback((a: Appearance) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolveTheme(a.theme));
    if (a.accent === "default") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", a.accent);

    // Feature flags: set "off" when disabled, otherwise clear the attribute.
    const flags = featureFlagAttrs(a);
    for (const name of FEATURE_FLAG_NAMES) {
      if (flags[name]) root.setAttribute(name, "off");
      else root.removeAttribute(name);
    }
  }, []);

  // Apply on mount + whenever appearance changes.
  useEffect(() => {
    applyToDom(appearance);
  }, [appearance, applyToDom]);

  // Track OS theme changes while in "auto".
  useEffect(() => {
    if (appearance.theme !== "auto" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyToDom(appearance);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [appearance, applyToDom]);

  const persist = useCallback(
    async (next: Appearance) => {
      try {
        const supabase = createClient();
        await supabase
          .from("profiles")
          .update({ appearance: next })
          .eq("id", userId);
      } catch {
        // Persistence is best-effort; the optimistic UI already updated.
      }
    },
    [userId],
  );

  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => {
      setAppearanceState((prev) => {
        const next = { ...prev, ...patch };
        applyToDom(next);
        void persist(next);
        return next;
      });
    },
    [applyToDom, persist],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      setAppearance,
      setTheme: (theme) => setAppearance({ theme }),
      setAccent: (accent) => setAppearance({ accent }),
      setUnits: (units) => setAppearance({ units }),
    }),
    [appearance, setAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the current appearance + setters. Must be used under ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

/**
 * Returns a `buzz()` that fires navigator.vibrate() ONLY when the user's
 * Haptics toggle is on and the device supports the Vibration API. Used by
 * the check-in (Mark Complete / block ticks) and crew reaction surfaces so
 * the "Buzz on check-ins & reactions" toggle does real work.
 */
export function useHaptics(): (pattern?: number | number[]) => void {
  const { appearance } = useTheme();
  const enabled = appearance.haptics;
  return useCallback(
    (pattern: number | number[] = 12) => {
      if (!enabled) return;
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
        return;
      }
      try {
        navigator.vibrate(pattern);
      } catch {
        // Vibration can throw in some embedded/insecure contexts — ignore.
      }
    },
    [enabled],
  );
}
