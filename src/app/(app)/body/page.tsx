import type { ReactNode } from "react";
import Link from "next/link";
import { Card, SectionHeader } from "@/components/ui";
import { getBodyToday, getProfile } from "@/lib/queries";
import {
  formatWeight,
  formatLength,
  formatVolume,
  weekdayLabel,
} from "@/lib/format";
import type { Units } from "@/lib/types";
import {
  BodyLogProvider,
  LogMetricsPill,
  LogLink,
  LogBlockButton,
  LogRow,
  MealRow,
  BodyHistoryLink,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   BODY & FUEL screen (server component).
   Loads getBodyToday + the profile (for units), renders the fuel ring,
   macro bars, body-metrics list, and today's fuel + water — with graceful
   empty states. All "+ Log" affordances open client sheets that call the
   logBody / logMeal / logWater actions. Ported from the Path Warden
   prototype's <section id="s-body">.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/* ── Local fuel goals (no goal column in the schema yet) ─────────────────
   Daily targets used to draw the ring + macro bars. Reasonable defaults for
   a backcountry-athlete profile; macro grams roughly back the kcal goal. */
const GOALS = {
  kcal: 2700,
  protein: 200, // g
  carbs: 320, // g
  fat: 80, // g
} as const;

function pct(value: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

/* ── Fuel ring (ported 130px SVG with gradient stroke) ───────────────── */
function FuelRing({ kcal, goal }: { kcal: number; goal: number }) {
  const size = 130;
  const stroke = 12;
  const r = (size - stroke) / 2; // 59
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct(kcal, goal));
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block"
      role="img"
      aria-label={`${kcal} of ${goal} kilocalories`}
    >
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,.07)"
        strokeWidth={stroke}
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="url(#fuelGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <defs>
        <linearGradient id="fuelGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <text
        x={center}
        y={center - 5}
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="30"
        fill="var(--text)"
      >
        {kcal}
      </text>
      <text
        x={center}
        y={center + 15}
        textAnchor="middle"
        fontFamily="var(--font-cond)"
        fontSize="11"
        letterSpacing="1"
        fill="var(--muted)"
      >
        / {goal} KCAL
      </text>
    </svg>
  );
}

/* ── Macro bar ───────────────────────────────────────────────────────── */
function Macro({
  value,
  label,
  fraction,
  color,
}: {
  value: number;
  label: string;
  fraction: number;
  color: string;
}) {
  return (
    <div className="flex-1">
      <div className="font-display text-lg font-bold text-text">{value}g</div>
      <div className="mt-0.5 font-cond text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-[7px] h-[5px] overflow-hidden rounded-[3px] bg-line-solid">
        <i
          className="block h-full rounded-[3px]"
          style={{ width: `${Math.round(fraction * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Log list row (icon · title · sub · value) ───────────────────────── */
function LogItem({
  icon,
  title,
  sub,
  value,
}: {
  icon: ReactNode;
  title: string;
  sub: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card className="mb-2.5 flex items-center gap-[13px] p-3.5">
      <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border border-line bg-surface2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.9]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
          {title}
        </div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="font-display text-base font-bold text-text">{value}</div>
    </Card>
  );
}

/* ── Icons (ported from the prototype) ───────────────────────────────── */
const Icons = {
  weight: (
    <svg viewBox="0 0 24 24">
      <path d="M3 12h18" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  waist: (
    <svg viewBox="0 0 24 24">
      <path d="M4 8h16M4 16h16" />
    </svg>
  ),
  bodyFat: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  ),
  meal: (
    <svg viewBox="0 0 24 24">
      <path d="M5 3v18M5 8h6M19 3c-2 4-2 7 0 10v8" />
    </svg>
  ),
  water: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" />
    </svg>
  ),
};

export default async function BodyPage() {
  const [body, profile] = await Promise.all([getBodyToday(), getProfile()]);
  const units: Units = profile?.units ?? "imperial";

  const { metric, meals, water, kcal, protein, carbs, fat } = body;
  const waterMl = water?.ml ?? 0;

  // Metrics are stored in the user's display unit (see _components note), so
  // format without an additional conversion.
  const weightStr = formatWeight(metric?.weight, units, { assumeMetric: false });
  const waistStr = formatLength(metric?.waist, units, { assumeMetric: false });
  const bodyFatStr =
    metric?.body_fat != null ? `${metric.body_fat}%` : "—";

  const dateLabel = `${weekdayLabel(new Date(), true)}, ${new Date().toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric" },
  )}`;

  return (
    <BodyLogProvider
      units={units}
      currentWeight={metric?.weight ?? null}
      currentBodyFat={metric?.body_fat ?? null}
      currentWaist={metric?.waist ?? null}
      currentWaterMl={waterMl}
    >
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            {dateLabel}
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Body &amp; Fuel
          </h1>
        </div>
        <LogMetricsPill />
      </div>

      {/* Fuel ring + macros — taps through to the first-class /diet screen. */}
      <Link href="/diet" className="block" aria-label="Open Nutrition">
      <Card className="mb-3.5 p-5 text-center">
        <FuelRing kcal={kcal} goal={GOALS.kcal} />
        <div className="mt-1.5 flex gap-2.5">
          <Macro
            value={protein}
            label="Protein"
            fraction={pct(protein, GOALS.protein)}
            color="var(--accent)"
          />
          <Macro
            value={carbs}
            label="Carbs"
            fraction={pct(carbs, GOALS.carbs)}
            color="var(--gold)"
          />
          <Macro
            value={fat}
            label="Fat"
            fraction={pct(fat, GOALS.fat)}
            color="var(--accent2)"
          />
        </div>
        {kcal === 0 ? (
          <p className="mt-3 font-cond text-[11px] uppercase tracking-wide text-faint">
            No fuel logged yet today
          </p>
        ) : null}
        <p className="mt-3 inline-flex items-center gap-1 font-cond text-[11px] font-semibold uppercase tracking-wide text-gold">
          Macros &amp; goals
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current [stroke-width:2.6]">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </p>
      </Card>
      </Link>

      {/* Body metrics */}
      <SectionHeader action={<BodyHistoryLink>History</BodyHistoryLink>}>
        Body Metrics
      </SectionHeader>
      {metric ? (
        <>
          <LogRow kind="body">
            <LogItem
              icon={Icons.weight}
              title="Bodyweight"
              sub={metric.weight != null ? "Tap to update" : "Not logged"}
              value={weightStr}
            />
          </LogRow>
          <LogRow kind="body">
            <LogItem
              icon={Icons.waist}
              title="Waist"
              sub={metric.waist != null ? "Tap to update" : "Not logged"}
              value={waistStr}
            />
          </LogRow>
          <LogRow kind="body">
            <LogItem
              icon={Icons.bodyFat}
              title="Body Fat"
              sub={metric.body_fat != null ? "Est." : "Not logged"}
              value={bodyFatStr}
            />
          </LogRow>
        </>
      ) : (
        <Card className="mb-2.5 p-5 text-center">
          <p className="mb-3 text-[13px] text-muted">
            No measurements logged today. Track bodyweight, waist &amp; body fat
            to watch the trend.
          </p>
          <LogBlockButton kind="body">Log Body Metrics</LogBlockButton>
        </Card>
      )}

      {/* Today's fuel */}
      <SectionHeader
        action={
          <span className="flex items-center gap-3">
            <Link
              href="/diet"
              className="font-cond text-[11px] font-semibold uppercase tracking-wide text-muted"
            >
              All macros
            </Link>
            <LogLink kind="meal">+ Add</LogLink>
          </span>
        }
      >
        Today&apos;s Fuel
      </SectionHeader>
      {meals.length ? (
        meals.map((m) => (
          <MealRow key={m.id} meal={m}>
            <LogItem
              icon={Icons.meal}
              title={m.meal?.trim() || "Meal"}
              sub={macroSub(m.protein, m.carbs, m.fat)}
              value={m.kcal ?? "—"}
            />
          </MealRow>
        ))
      ) : (
        <Card className="mb-2.5 p-5 text-center">
          <p className="mb-3 text-[13px] text-muted">
            Nothing logged yet. Add a meal to fill your fuel ring.
          </p>
          <LogBlockButton kind="meal">Log a Meal</LogBlockButton>
        </Card>
      )}

      {/* Water */}
      <SectionHeader action={<LogLink kind="water">+ Log</LogLink>}>
        Water
      </SectionHeader>
      <LogRow kind="water">
        <LogItem
          icon={Icons.water}
          title="Water"
          sub={waterMl > 0 ? "Tap to add more" : "Tap to start logging"}
          value={waterMl > 0 ? formatVolume(waterMl, units) : "—"}
        />
      </LogRow>
    </BodyLogProvider>
  );
}

/** Compact "P/C/F" macro sub-label for a meal row. */
function macroSub(
  protein: number | null,
  carbs: number | null,
  fat: number | null,
): string {
  const parts: string[] = [];
  if (protein != null) parts.push(`${protein}P`);
  if (carbs != null) parts.push(`${carbs}C`);
  if (fat != null) parts.push(`${fat}F`);
  return parts.length ? parts.join(" · ") : "Logged";
}
