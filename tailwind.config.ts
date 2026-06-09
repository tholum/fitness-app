import type { Config } from "tailwindcss";

/**
 * Colors map to CSS custom properties defined in globals.css. This is the
 * heart of the theme-token engine: swapping the variables (per theme / per
 * user) re-skins the whole app without touching component classes.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Hex-backed tokens use CSS relative color so Tailwind alpha
        // modifiers compose (bg-accent2/40, bg-bg/15, …) — a plain
        // "var(--x)" silently drops the whole rule when a /NN modifier is
        // used. `from var(--x)` keeps the variable (incl. user accent
        // overrides) as the single source of truth.
        bg: "rgb(from var(--bg) r g b / <alpha-value>)",
        bg2: "rgb(from var(--bg2) r g b / <alpha-value>)",
        surface: "var(--surface)", // already rgba — no alpha modifier support
        "surface-solid": "rgb(from var(--surface-solid) r g b / <alpha-value>)",
        surface2: "rgb(from var(--surface2) r g b / <alpha-value>)",
        line: "var(--line)", // already rgba — no alpha modifier support
        "line-solid": "rgb(from var(--line-solid) r g b / <alpha-value>)",
        text: "rgb(from var(--text) r g b / <alpha-value>)",
        muted: "rgb(from var(--muted) r g b / <alpha-value>)",
        faint: "rgb(from var(--faint) r g b / <alpha-value>)",
        accent: "rgb(from var(--accent) r g b / <alpha-value>)",
        accent2: "rgb(from var(--accent2) r g b / <alpha-value>)",
        "nav-active": "rgb(from var(--nav-active) r g b / <alpha-value>)",
        gold: "rgb(from var(--gold) r g b / <alpha-value>)",
        danger: "rgb(from var(--danger) r g b / <alpha-value>)",
        // Ink on the orange gradient / solid accent — theme-invariant.
        "on-grad": "rgb(from var(--on-grad) r g b / <alpha-value>)",
      },
      borderRadius: {
        card: "var(--radius)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        cond: ["var(--font-cond)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        grad: "var(--grad)",
        grad2: "var(--grad2)",
      },
    },
  },
  plugins: [],
};

export default config;
