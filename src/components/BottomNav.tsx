"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/* ════════════════════════════════════════════════════════════════════
   BOTTOM NAV
   Fixed, blurred bar with the center [FAB Check-In] flanked by primary
   destinations: Today · Crew · [FAB] · Body · Progress · Account.
   This mirrors the Path Warden prototype's airy 4+FAB rhythm (Today · Crew
   · [FAB] · Body · Progress) and keeps Account as the one extra tab: it
   is the only entry to profile + sign-out and doubles as the management
   hub, surfacing Programs / Exercises / Appearance as quick links (so
   plan authoring stays reachable without its own persistent tab — gaps
   1,26,32). Active route highlights in the accent color.
   Ported from the Path Warden prototype's <nav class="nav">.
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
    href: "/body",
    label: "Body",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 12c4 0 4-6 9-6s5 6 9 6-4 6-9 6-5-6-9-6z" />
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

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 flex h-[84px] w-full max-w-[430px] -translate-x-1/2 items-center border-t border-line bg-bg2/70 px-1.5 pb-[18px] backdrop-blur-2xl"
      style={{ paddingBottom: "calc(18px + env(safe-area-inset-bottom))" }}
    >
      {LEFT_ITEMS.map((item) => (
        <NavButton key={item.href} item={item} pathname={pathname} />
      ))}

      <Link
        href="/checkin"
        aria-label="Check In"
        className="mx-1.5 -mt-5 flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-full bg-grad shadow-[0_8px_22px_rgba(200,98,45,.5)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[26px] w-[26px] fill-none stroke-bg [stroke-width:2.6]"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </Link>

      {RIGHT_ITEMS.map((item) => (
        <NavButton key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}
