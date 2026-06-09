"use client";

import { useMemo, useState } from "react";
import { Card, SectionHeader, Segmented } from "@/components/ui";
import {
  useTheme,
  DEFAULT_APPEARANCE,
  type Accent,
  type Energy,
  type ThemeMode,
  type Units,
} from "@/components/ThemeProvider";
import {
  AccentSwatches,
  HomeCardsList,
  OptionCard,
  ToggleRow,
  type AccentSwatch,
  type HomeCardDef,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   APPEARANCE — "Make it yours"
   Ports the prototype Look screen. Every control is bound to useTheme():
   setAppearance() applies the change to <html data-theme / data-accent>
   immediately AND persists it to profiles.appearance in the background,
   so changes are live and survive reloads.
   ════════════════════════════════════════════════════════════════════ */

/** Accent swatches — gradients mirror the token gradients in globals.css. */
const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { value: "default", label: "Blaze", gradient: "linear-gradient(135deg,#c8622d,#d9a441)" },
  { value: "moss", label: "Moss", gradient: "linear-gradient(135deg,#7a8b52,#c8622d)" },
  { value: "rust", label: "Rust", gradient: "linear-gradient(135deg,#d9a441,#b5483a)" },
  { value: "slate", label: "Slate", gradient: "linear-gradient(135deg,#5a7d8c,#7a8b52)" },
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: string }>;

const ENERGY_OPTIONS = [
  { value: "calm", label: "Calm" },
  { value: "standard", label: "Standard" },
  { value: "hyped", label: "Hyped" },
] as const satisfies ReadonlyArray<{ value: Energy; label: string }>;

const UNITS_OPTIONS = [
  { value: "imperial", label: "Imperial" },
  { value: "metric", label: "Metric" },
] as const satisfies ReadonlyArray<{ value: Units; label: string }>;

/** Canonical Home Cards shown on Today (key persisted in appearance.widgets). */
const HOME_CARDS: readonly HomeCardDef[] = [
  { key: "session", label: "Today's Session" },
  { key: "rings", label: "Activity Rings" },
  { key: "crew", label: "Crew Today" },
];
const ALL_CARD_KEYS = HOME_CARDS.map((c) => c.key);

/**
 * Build the full ordering of every card key from the persisted enabled list:
 * saved (enabled) keys first in their saved order, then any remaining
 * canonical cards. Unknown/stale keys are dropped.
 */
function buildFullOrder(enabled: readonly string[]): string[] {
  const known = enabled.filter((k) => ALL_CARD_KEYS.includes(k));
  const rest = ALL_CARD_KEYS.filter((k) => !known.includes(k));
  return [...known, ...rest];
}

export default function AppearancePage() {
  const { appearance, setAppearance, setTheme, setAccent, setUnits } = useTheme();

  // Full ordering (incl. disabled) lives locally for smooth reorder UX;
  // the enabled subset (in this order) is the persisted source of truth.
  const [order, setOrder] = useState<string[]>(() => buildFullOrder(appearance.widgets));
  const enabledSet = useMemo(() => new Set(appearance.widgets), [appearance.widgets]);

  function persistWidgets(nextOrder: string[]) {
    const widgets = nextOrder.filter((k) => enabledSet.has(k));
    setAppearance({ widgets });
  }

  function handleReorder(nextOrder: string[]) {
    setOrder(nextOrder);
    persistWidgets(nextOrder);
  }

  function handleToggleCard(key: string, next: boolean) {
    // Recompute the enabled list directly from the live order so the
    // persisted widgets keep their on-screen ordering.
    const widgets = order.filter((k) =>
      k === key ? next : enabledSet.has(k),
    );
    setAppearance({ widgets });
  }

  function resetHomeCards() {
    const defaults = DEFAULT_APPEARANCE.widgets;
    setOrder(buildFullOrder(defaults));
    setAppearance({ widgets: [...defaults] });
  }

  return (
    <>
      {/* Header — mirrors the prototype's .hd ("Make it yours" / Appearance). */}
      <header className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            Make it yours
          </div>
          <h1 className="mt-[3px] font-display text-[30px] font-bold uppercase leading-none tracking-[0.03em] text-text">
            Appearance
          </h1>
        </div>
      </header>

      {/* Accent gradient */}
      <OptionCard
        label="Accent Gradient"
        description="Powers your session card, rings & buttons."
      >
        <AccentSwatches
          swatches={ACCENT_SWATCHES}
          value={appearance.accent}
          onChange={(a: Accent) => setAccent(a)}
        />
      </OptionCard>

      {/* Theme */}
      <OptionCard label="Theme" description="Dark-first for low-light field use.">
        <Segmented
          options={THEME_OPTIONS}
          value={appearance.theme}
          onChange={(t) => setTheme(t)}
        />
      </OptionCard>

      {/* Energy */}
      <OptionCard label="Energy" description="Animation, glow & celebration level.">
        <Segmented
          options={ENERGY_OPTIONS}
          value={appearance.energy}
          onChange={(e) => setAppearance({ energy: e })}
        />
      </OptionCard>

      {/* Units */}
      <OptionCard label="Units" description="Weights, distances & measurements.">
        <Segmented
          options={UNITS_OPTIONS}
          value={appearance.units}
          onChange={(u) => setUnits(u)}
        />
      </OptionCard>

      {/* Feature toggles (grouped card) */}
      <Card>
        <ToggleRow
          label="Crew & Social"
          description="Crew tab, feed, nudges, reactions"
          checked={appearance.crewSocial}
          onChange={(v) => setAppearance({ crewSocial: v })}
        />
        <ToggleRow
          bordered
          label="Gamification"
          description="XP, levels, streaks & badges"
          checked={appearance.gamification}
          onChange={(v) => setAppearance({ gamification: v })}
        />
        <ToggleRow
          bordered
          label="Topographic texture"
          description="Contour lines behind screens"
          checked={appearance.topoTexture}
          onChange={(v) => setAppearance({ topoTexture: v })}
        />
        <ToggleRow
          bordered
          label="Haptics"
          description="Buzz on check-ins & reactions"
          checked={appearance.haptics}
          onChange={(v) => setAppearance({ haptics: v })}
        />
      </Card>

      {/* Home cards (reorder + toggle) */}
      <SectionHeader
        action={
          <button
            type="button"
            onClick={resetHomeCards}
            className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold"
          >
            Reset
          </button>
        }
      >
        Home Cards
      </SectionHeader>
      <p className="mx-1 mb-3.5 text-[11px] italic text-faint">
        Drag to reorder what shows on Today.
      </p>
      <HomeCardsList
        cards={HOME_CARDS}
        order={order}
        enabled={appearance.widgets}
        onReorder={handleReorder}
        onToggle={handleToggleCard}
      />
    </>
  );
}
