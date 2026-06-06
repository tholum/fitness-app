"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { QuickLogFab, type QuickLogTracker } from "@/components/QuickLogFab";

/* ════════════════════════════════════════════════════════════════════
   BOTTOM NAV
   In-flow, blurred bar with the center [FAB quick-log] flanked by the
   primary destinations:  Today · Crew · [FAB] · Goals · Progress · Account.

   Phase 6 IA (5 tabs + a universal-log FAB):
     • Today    — the unified weekly dashboard (every goal at a glance) +
                  the active session hero.
     • Crew     — cooperative crew feed + crew goal progress.
     • [FAB]    — QuickLogFab: a launcher to Check In or log ANY goal today
                  (reaches every tracker without crowding the bar).
     • Goals    — the hub linking the four first-class areas (Training /
                  Nutrition / Bible / Custom) and listing every active goal.
     • Progress — gamified stats / PRs / badges.
     • Account  — profile, sign-out, and the management hub (Body &
                  Nutrition / Programs / Exercises / Appearance as quick
                  links, so secondary screens stay reachable).
   Active route highlights in the accent color.
   ════════════════════════════════════════════════════════════════════ */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Extra classes on the link (e.g. a feature-gate class). */
  className?: string;
}

/** Destinations left of the center FAB. */
const LEFT_ITEMS: NavItem[] = [
  {
    href: "/today",
    label: "Today",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 11l9-8 9 8M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    href: "/crew",
    label: "Crew",
    // Hidden when Appearance → Crew & Social is off (see globals.css gate).
    className: "crew-feature",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1M15 14h1a4 4 0 014 4v2" />
      </svg>
    ),
  },
];

/** Destinations right of the center FAB. */
const RIGHT_ITEMS: NavItem[] = [
  {
    href: "/goals",
    label: "Goals",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.4" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
      </svg>
    ),
  },
  {
    href: "/progress",
    label: "Progress",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 14l5-5 4 4 7-8" />
      </svg>
    ),
  },
  {
    href: "/account",
    label: "Account",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M4.5 20a7.5 7.5 0 0115 0" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavButton({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-1 pt-3.5 font-cond text-[9px] font-semibold uppercase tracking-wide [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:1.9] ${
        active ? "text-nav-active" : "text-faint"
      }${item.className ? ` ${item.className}` : ""}`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

export function BottomNav({
  quickLogTrackers = [],
}: {
  /** Active trackers fed to the center quick-log FAB (from the app layout). */
  quickLogTrackers?: QuickLogTracker[];
}) {
  const pathname = usePathname();

  return (
    <nav
      className="relative w-full flex-none flex h-[84px] items-center border-t border-line bg-bg2/70 px-1.5 backdrop-blur-2xl"
      style={{ paddingBottom: "calc(18px + env(safe-area-inset-bottom))" }}
    >
      {LEFT_ITEMS.map((item) => (
        <NavButton key={item.href} item={item} pathname={pathname} />
      ))}

      <QuickLogFab trackers={quickLogTrackers} />

      {RIGHT_ITEMS.map((item) => (
        <NavButton key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}
