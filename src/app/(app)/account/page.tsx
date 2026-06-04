import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/queries";
import { Card, SectionHeader } from "@/components/ui";
import { ProfileForm, SignOutButton } from "./_components";

/* ════════════════════════════════════════════════════════════════════
   ACCOUNT (/account) — gaps 26,27.
   Server component. Reads the profile (getProfile) plus the auth email,
   renders an editable display_name + avatar_url card (→ updateProfile)
   and a Sign Out control (POSTs to /auth/signout). Also surfaces quick
   links into Appearance / Programs / Exercises so management screens are
   reachable from one place. Styled with BASECAMP Card/Button tokens.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface QuickLink {
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  {
    href: "/goals",
    label: "Training Goals",
    sub: "Your weekly schedule & streak rule",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.4" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
      </svg>
    ),
  },
  {
    href: "/programs",
    label: "Programs",
    sub: "Build & manage training plans",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 5h16M4 12h16M4 19h10" />
      </svg>
    ),
  },
  {
    href: "/exercises",
    label: "Exercises",
    sub: "Your reusable movement library",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />
      </svg>
    ),
  },
  {
    href: "/appearance",
    label: "Appearance",
    sub: "Theme, accent, units & home cards",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3v2.5M12 18.5V21M4.2 4.2l1.8 1.8M18 18l1.8 1.8M3 12h2.5M18.5 12H21M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
      </svg>
    ),
  },
];

function QuickLinkRow({ link }: { link: QuickLink }) {
  return (
    <Link href={link.href} className="block">
      <Card className="flex items-center gap-[13px] p-3.5">
        <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px] border border-line bg-surface2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-none [&_svg]:stroke-accent [&_svg]:[stroke-width:1.9]">
          {link.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-text">
            {link.label}
          </div>
          <div className="truncate text-xs text-muted">{link.sub}</div>
        </div>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-5 w-5 flex-shrink-0 fill-none stroke-faint [stroke-width:2]"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Card>
    </Link>
  );
}

export default async function AccountPage() {
  const [profile, supabase] = await Promise.all([getProfile(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? null;
  const displayName = profile?.display_name ?? "";
  const avatarUrl = profile?.avatar_url ?? null;

  return (
    <>
      {/* Header — matches the prototype .hd pattern. */}
      <header className="relative z-10 flex items-center justify-between px-0.5 pb-[18px] pt-2">
        <div>
          <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
            Your basecamp
          </div>
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-[0.03em] text-text">
            Account
          </h1>
        </div>
      </header>

      <SectionHeader>Profile</SectionHeader>
      <ProfileForm
        email={email}
        initialDisplayName={displayName}
        initialAvatarUrl={avatarUrl}
      />

      <SectionHeader>Manage</SectionHeader>
      <div className="space-y-2.5">
        {QUICK_LINKS.map((link) => (
          <QuickLinkRow key={link.href} link={link} />
        ))}
      </div>

      <SectionHeader>Session</SectionHeader>
      <SignOutButton />
      <p className="mx-1 mt-3 text-center text-[11px] text-faint">
        Signed in{email ? ` as ${email}` : ""}.
      </p>
    </>
  );
}
