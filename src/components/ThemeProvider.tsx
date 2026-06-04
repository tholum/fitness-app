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

/* ════════════════════════════════════════════════════════════════════
   THEME PROVIDER
   Holds the user's appearance preferences (stored in profiles.appearance
   as JSON). Mutations update the live <html data-theme / data-accent>
   attributes immediately and persist to Supabase in the background.
   ════════════════════════════════════════════════════════════════════ */

export type ThemeMode = "dark" | "light" | "auto";
/** "default" keeps the base blaze→gold gradient (no data-accent attribute). */
export type Accent = "default" | "moss" | "rust" | "slate";
export type Energy = "calm" | "standard" | "hyped";
export type Units = "imperial" | "metric";

export interface Appearance {
  theme: ThemeMode;
  accent: Accent;
  energy: Energy;
  units: Units;
  crewSocial: boolean;
  gamification: boolean;
  topoTexture: boolean;
  haptics: boolean;
  /** Ordered list of home-card widget keys shown on Today. */
  widgets: string[];
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  accent: "default",
  energy: "standard",
  units: "imperial",
  crewSocial: true,
  gamification: true,
  topoTexture: true,
  haptics: true,
  widgets: ["session", "rings", "crew"],
};

/** Merge an unknown JSON blob from the DB with the defaults (typed + safe). */
export function normalizeAppearance(raw: unknown): Appearance {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], def: T): T =>
    allowed.includes(v as T) ? (v as T) : def;
  const bool = (v: unknown, def: boolean): boolean =>
    typeof v === "boolean" ? v : def;

  return {
    theme: oneOf(a.theme, ["dark", "light", "auto"] as const, DEFAULT_APPEARANCE.theme),
    accent: oneOf(
      a.accent,
      ["default", "moss", "rust", "slate"] as const,
      DEFAULT_APPEARANCE.accent,
    ),
    energy: oneOf(a.energy, ["calm", "standard", "hyped"] as const, DEFAULT_APPEARANCE.energy),
    units: oneOf(a.units, ["imperial", "metric"] as const, DEFAULT_APPEARANCE.units),
    crewSocial: bool(a.crewSocial, DEFAULT_APPEARANCE.crewSocial),
    gamification: bool(a.gamification, DEFAULT_APPEARANCE.gamification),
    topoTexture: bool(a.topoTexture, DEFAULT_APPEARANCE.topoTexture),
    haptics: bool(a.haptics, DEFAULT_APPEARANCE.haptics),
    widgets: Array.isArray(a.widgets) && a.widgets.every((w) => typeof w === "string")
      ? (a.widgets as string[])
      : DEFAULT_APPEARANCE.widgets,
  };
}

/** Resolve the [data-theme] value (auto follows the OS preference). */
function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "auto") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return "dark";
  }
  return mode;
}

/* ── Feature-flag attributes ──────────────────────────────────────────────
   The boolean Appearance toggles drive real rendering via [data-*="off"]
   attributes on <html> + matching CSS in globals.css. This mirrors the
   theme-token engine ([data-theme]/[data-accent]) so server components (the
   Today / Crew / Progress pages and the app shell) honor the toggles without
   prop-drilling, and changes are live (no reload). A flag is only present
   when OFF; the default (ON) leaves the attribute absent so nothing hides. */

/** Map of [data-*] attribute → "off" for each boolean flag that is disabled. */
export function featureFlagAttrs(a: Appearance): Record<string, "off"> {
  const out: Record<string, "off"> = {};
  if (!a.crewSocial) out["data-crew"] = "off";
  if (!a.gamification) out["data-gamify"] = "off";
  if (!a.topoTexture) out["data-topo"] = "off";
  return out;
}

/** All flag attribute names — used to clear stale ones before re-applying. */
const FEATURE_FLAG_NAMES = ["data-crew", "data-gamify", "data-topo"] as const;

/**
 * Inline script (no-flash): set the feature-flag attributes on <html>
 * synchronously from the server-known appearance, before first paint, so a
 * user who turned a feature OFF never sees it flash on during hydration.
 * Render via <script dangerouslySetInnerHTML={{ __html: featureFlagScript(a) }} />.
 */
export function featureFlagScript(a: Appearance): string {
  const attrs = featureFlagAttrs(a);
  return `(function(){var e=document.documentElement;${FEATURE_FLAG_NAMES.map(
    (n) =>
      attrs[n] ? `e.setAttribute(${JSON.stringify(n)},"off");` : `e.removeAttribute(${JSON.stringify(n)});`,
  ).join("")}})();`;
}

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
