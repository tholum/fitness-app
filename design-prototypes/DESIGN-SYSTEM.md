# Fitness App — Design System & Look-and-Feel Variants

> **How to view:** Open `design-prototypes/index.html` in a browser to see all three phones side-by-side, or open any `variant-*/index.html` fullscreen. Each prototype has 5 working screens — **Today, Train, Body & Fuel, Progress, Look** — switchable from the bottom nav. The **Look** tab demonstrates that variant's appearance-configuration system.

This document covers, for each variant:
1. Design philosophy & who it's for
2. Full design tokens (color, type, spacing, radius, motion)
3. Component language (cards, buttons, nav, inputs)
4. **Every user-configurable appearance option** (the planning piece you asked for)
5. How the look is *technically* configured (token architecture)

It ends with a shared section: the cross-platform config model (mobile vs PWA vs desktop), the data model these screens imply, and a recommended Supabase + client stack.

---

## The three directions at a glance

| | **01 · SUMMIT** | **02 · PULSE** | **03 · FORGE** |
|---|---|---|---|
| Philosophy | Rugged backcountry tool | Clinical, data-first | Gamified arcade |
| Mood | Earthy, gritty, utilitarian | Calm, precise, airy | Loud, energetic, rewarding |
| Default theme | Dark-first | Light-first | OLED-dark-first |
| Type | Oswald + Barlow (condensed) | Inter + IBM Plex Mono | Sora + Space Grotesk |
| Shape | Sharp (6px radius) | Soft (16px radius) | Pill/blob (22px radius) |
| Signature | Topographic contour texture | Monospace tabular numbers | Neon gradients + activity rings |
| Motion | Minimal, weighty | Subtle, functional | Springy, celebratory (confetti) |
| Best if you want | A serious tool that feels like gear | Trust, clarity, "Apple Health" precision | Habit-forming, fun, streak-driven |

---

## 01 · SUMMIT — Rugged Backcountry

**Philosophy.** Feels like a piece of equipment in your pack, not a consumer app. High-contrast dark UI for low-light/field use, condensed military-stencil type, blaze-orange (hunter) accent, and a faint topographic contour texture behind every screen. Information is dense and direct.

**Who it's for.** Someone deep in MTNTOUGH who identifies with the mountain-athlete / backcountry-hunter ethos and wants a tool that matches.

### Design tokens

```
Color (dark default)
  bg            #1c1a17   charred bark
  surface       #2f2b26   raised card
  surface2      #3a352e   input wells
  line          #4a443b   borders
  text          #ece6da   bone
  muted         #9b9082
  accent        #c8622d   blaze orange  ← primary
  accent2       #7a8b52   moss (success/conditioning)
  gold          #d9a441   PRs / records
  danger        #b5483a

Type
  display   Oswald 700, UPPERCASE, +1px letterspacing
  labels    Barlow Semi Condensed 600, UPPERCASE, +2px
  body      Barlow 400/500/600

Radius     6px (sharp)
Spacing    20px screen gutter, 12–14px card padding
Motion     150–200ms, ease-out, no bounce
Texture    SVG topo contour lines at 6% opacity
```

### Component language
- **Cards:** flat, 1px border, sharp corners, subtle inner texture.
- **Buttons:** rectangular, Oswald uppercase, blaze fill or ghost outline.
- **Bottom nav:** 5 tabs, condensed labels, blaze active state.
- **Inputs (Train):** dark wells with small uppercase unit captions; big tappable "done" checks turn moss-green.
- **Hero:** layered mountain-ridge silhouette + progress bar.

### User-configurable appearance options (the **Look** tab)
| Option | Choices | Notes |
|---|---|---|
| Accent color | Blaze · Moss · Gold · Rust-red · Slate-blue | Drives buttons, highlights, rings |
| Theme | **Trailhead Dark** (default) · Alpine Light · Auto | Auto follows OS |
| Typography scale | Compact · **Standard** · Large | 3 density steps |
| Units | **Imperial** · Metric | App-wide |
| Topographic texture | On / Off | The signature contour background |
| Haptic feedback | On / Off | Set completion & PRs |
| Big-Glove mode | On / Off | Oversized tap targets for cold-weather use |
| Dashboard widgets | Reorder + toggle | Today's Session, Quick Stats, Up Next, Fuel Ring |

---

## 02 · PULSE — Clinical Minimalist

**Philosophy.** The opposite of SUMMIT. Light, generous whitespace, a single confident blue accent, and **monospace tabular numbers** so data is always aligned and scannable. Every screen reads like a well-designed medical/quantified-self dashboard. Restraint is the brand.

**Who it's for.** Someone who wants to *trust the numbers* — week-over-week deltas, sparklines, RPE, resting HR — without visual noise. Reads as premium and credible.

### Design tokens

```
Color (light default)
  bg            #f4f5f7
  surface       #ffffff
  surface2      #fafbfc   input fills
  line          #e6e8ec
  text          #0f1115
  muted         #6b7280
  accent        #1463ff   clinical blue  ← primary
  accent-soft   #e7f0ff   tints / chips
  good          #0f9d6e   positive delta
  warn          #e8a33d
  bad           #e2483b   negative delta

Type
  ui        Inter 400–800, tight tracking (-0.5 to -1px on headings)
  numbers   IBM Plex Mono, tabular-nums  ← signature
Radius     16px (soft)
Spacing    20px gutter, 16–18px card padding, lots of air
Motion     subtle, 120–160ms; respects "reduce motion"
```

### Component language
- **Cards:** white, hairline border, generous padding, no texture.
- **Metric tiles:** 2-up grid, big mono value + colored delta + optional sparkline.
- **Buttons:** solid blue, fully rounded 14px; secondary = white with border.
- **Train table:** true spreadsheet feel — column headers, mono inputs, green check.
- **Charts:** thin line + faint area fill, gridlines, single data point highlight.

### User-configurable appearance options (the **Look** tab)
| Option | Choices | Notes |
|---|---|---|
| Accent | Blue · Green · Violet · Red · Ink-black | Charts/buttons/rings |
| Theme | **Light** (default) · Dark · System | True dark variant available |
| Number style | **Mono** · Proportional | Mono = aligned tabular figures |
| Units | **Imperial** · Metric | App-wide |
| Show deltas | On / Off | Week-over-week change chips |
| Sparklines | On / Off | Mini trends on metric tiles |
| Reduce motion | On / Off | Accessibility |
| Today layout | Reorder + toggle | Program progress, Metric tiles, Today's session, Sleep & recovery |

---

## 03 · FORGE — Bold Gamified

**Philosophy.** Pure energy. OLED-black canvas, ambient neon glow, vivid pink→violet gradients, and a game layer on top of everything: today is a **"quest,"** workouts award **XP**, you have a **level**, a **streak**, activity **rings**, and unlockable **badges**. Glassmorphism (frosted blur) on cards. Built to be habit-forming.

**Who it's for.** Someone motivated by momentum and rewards — streaks, leveling up, celebrating PRs with confetti. The most "consumer/social" of the three.

### Design tokens

```
Color (OLED dark default)
  bg            #0a0a14
  surface       rgba(255,255,255,.045)  glass
  line          rgba(255,255,255,.09)
  text          #f2f2fa
  muted         #9a9ab5
  c1            #ff2e88   hot pink
  c2            #7b5cff   violet
  c3            #16e0c8   cyan
  c4            #ffd23f   gold
  grad          linear-gradient(135deg, #ff2e88, #7b5cff)  ← primary
  + ambient radial glows behind the canvas

Type
  display   Sora 700/800, gradient text-fill on headings
  numbers   Space Grotesk 700
Radius     22px (pill/blob), 50% on rings & FAB
Spacing    18px gutter, 16–20px padding
Motion     springy; confetti on PRs; glowing progress bars
Effects    backdrop-blur glass, neon box-shadows
```

### Component language
- **Hero "Quest":** full-gradient card with XP bar + circular play button.
- **Activity rings:** Apple-Watch-style trio (Fuel / Move / Water).
- **Bottom nav:** 4 tabs + center gradient **FAB** (quick-add/start).
- **Train:** gradient video-thumb per exercise, glassy set rows, "Claim XP" CTA.
- **Progress:** level badge, XP-to-next-level bar, scrollable badge shelf (locked/unlocked).

### User-configurable appearance options (the **Look** tab)
| Option | Choices | Notes |
|---|---|---|
| Gradient theme | Pink→Violet · Cyan→Violet · Gold→Orange · Aqua→Blue | Powers hero, rings, buttons |
| Mood | **Midnight** · Nebula · Daylight | Light mode dims the glow |
| Energy | Calm · **Hyped** · Max | Amount of animation/celebration |
| Gamification | On / Off | XP, levels, streaks, badges (turn it all off if you hate it) |
| Confetti on PRs | On / Off | |
| Glassmorphism | On / Off | Frosted blur on cards |
| Haptics | On / Off | Reps & rewards |
| Home cards | Reorder + toggle | Hero Quest, Activity Rings, Today's Quests, Leaderboard |

---

## How "the look" is configured (token architecture)

All three variants are the **same screens driven by a theme token set**. That's the key planning decision: don't hard-code colors/fonts into components — drive everything from a token object so a variant (and every user override) is just a different set of token values.

```ts
// One shape, three presets, plus per-user overrides on top.
type ThemeTokens = {
  name: 'summit' | 'pulse' | 'forge';
  mode: 'dark' | 'light' | 'auto';
  color: { bg; surface; line; text; muted; accent; success; warn; danger; ... };
  font:  { display; body; mono };
  radius: number;          // 6 | 16 | 22
  density: 'compact' | 'standard' | 'large';
  effects: { texture?: bool; glass?: bool; glow?: bool; confetti?: bool };
  gamified: boolean;       // FORGE-style XP/streaks/badges layer
};

type UserAppearance = Partial<ThemeTokens> & {
  units: 'imperial' | 'metric';
  reduceMotion: boolean;
  haptics: boolean;
  dashboardWidgets: { id: string; enabled: boolean; order: number }[];
};
```

- Ship the three presets as JSON. **Resolved theme = preset ⊕ user overrides.**
- Expose tokens as CSS custom properties (`--accent`, `--radius`, …) so the same component tree restyles instantly — exactly how these prototypes work.
- Persist `UserAppearance` per user in Supabase (`profiles.appearance jsonb`) so it syncs across mobile / PWA / desktop.

### Configurable surface, grouped (applies to whichever variant wins)
- **Brand:** accent/gradient, theme mode, signature effect (texture / sparklines / glass+glow).
- **Type & density:** font scale, compact/standard/large, mono vs proportional numbers.
- **Data:** units (imperial/metric), first day of week, default landing tab, show/hide deltas & sparklines.
- **Layout:** reorderable + toggleable dashboard widgets; which metrics appear on Today.
- **Behavior:** haptics, reduce-motion, gamification on/off, confetti, big-glove mode.
- **Notifications (planned):** session reminders, streak nudges, weigh-in reminders.

---

## Cross-platform plan (mobile / PWA / desktop)

You said: **mobile (Android PWA)** = day-to-day tracking; **web/desktop PWA** = same plus *advanced configuration* (uploading plans, etc.). Mapping:

| Capability | Mobile (primary) | Web / Desktop |
|---|---|---|
| Log workouts, sets, rucks | ✅ core | ✅ |
| Body metrics & nutrition logging | ✅ core | ✅ |
| View progress / PRs / badges | ✅ | ✅ (richer charts) |
| Appearance config | ✅ (the Look tab) | ✅ |
| **Upload / author training plans** | view only | ✅ **desktop-first** |
| Bulk import (CSV, exercise library) | — | ✅ |
| Coach / multi-athlete admin (future) | — | ✅ |

- **One codebase, responsive + installable PWA** is the lean path (e.g. React/Next or SvelteKit → installable on Android + desktop). The token system above means all three platforms share components and restyle from the same theme.
- If Android needs native features later (background HR, health-connect, offline-first), wrap the PWA (Capacitor) or go React Native — but start PWA.

## Data model these screens imply (for Supabase)

```
profiles(id, display_name, appearance jsonb, units, level, xp, streak_count)
programs(id, name, source 'MTNTOUGH'|custom, phases, owner_id)
program_days(id, program_id, phase, week, day, title, est_minutes)
blocks(id, program_day_id, label, type 'strength'|'conditioning'|'mobility', order)
exercises(id, block_id, name, scheme, target, video_url, order)
workout_logs(id, user_id, program_day_id, started_at, completed_at, rpe, notes)
set_logs(id, workout_log_id, exercise_id, set_no, weight, reps, distance, time, hr)
body_metrics(id, user_id, date, weight, bodyfat, waist, measurements jsonb)
nutrition_logs(id, user_id, date, meal, kcal, protein, carbs, fat)
water_logs(id, user_id, date, ml)
prs(id, user_id, exercise_id, metric, value, achieved_on)
achievements / badges(id, user_id, key, earned_on)   -- FORGE layer
```

Supabase fit: Postgres + **Row Level Security** per `user_id`, **Auth** (email/OAuth), **Storage** for plan uploads / progress photos / exercise videos, **Realtime** for live workout sync, **Edge Functions** for plan-file parsing on upload.

---

## Recommended next step

1. **Pick a direction** (or tell me which pieces you like from each — e.g. "SUMMIT's vibe but PULSE's data clarity" is very doable, since they're the same token system).
2. I'll refine the winner into a tighter spec + a couple more screens (login, plan-upload on desktop, program browser).
3. Then scaffold the actual project: PWA shell, Supabase schema + RLS, auth, and the theme-token engine so the look stays configurable.

Tell me what landed and what didn't, and I'll iterate.
