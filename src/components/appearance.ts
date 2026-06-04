/* ════════════════════════════════════════════════════════════════════
   APPEARANCE — pure, framework-agnostic helpers + types.

   This module has NO "use client" directive on purpose: server components
   (the app shell, the Today page) call normalizeAppearance / featureFlagScript
   directly, and a "use client" module's non-component exports cannot be invoked
   from the server. The live ThemeProvider context + hooks live in
   ./ThemeProvider (client) and import their shared logic from here.
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
export function resolveTheme(mode: ThemeMode): "dark" | "light" {
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
export const FEATURE_FLAG_NAMES = ["data-crew", "data-gamify", "data-topo"] as const;

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
