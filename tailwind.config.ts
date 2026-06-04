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
        bg: "var(--bg)",
        bg2: "var(--bg2)",
        surface: "var(--surface)",
        "surface-solid": "var(--surface-solid)",
        surface2: "var(--surface2)",
        line: "var(--line)",
        "line-solid": "var(--line-solid)",
        text: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        accent2: "var(--accent2)",
        "nav-active": "var(--nav-active)",
        gold: "var(--gold)",
        danger: "var(--danger)",
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
