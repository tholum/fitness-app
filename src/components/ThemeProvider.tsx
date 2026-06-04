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

  /** Apply theme + accent to the document root so every token re-skins. */
  const applyToDom = useCallback((a: Appearance) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolveTheme(a.theme));
    if (a.accent === "default") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", a.accent);
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
