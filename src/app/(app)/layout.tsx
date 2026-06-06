import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import { ConfirmProvider } from "@/components/Confirm";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  normalizeAppearance,
  featureFlagScript,
  DEFAULT_APPEARANCE,
} from "@/components/appearance";

/**
 * Authenticated app shell. Guards every (app) route, loads the user's
 * appearance preferences, and renders the Path Warden phone-style column
 * (centered, max ~430px) with the fixed bottom navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request CSP nonce set by middleware; tags the no-flash inline script
  // below so it is allowed under the nonce-based Content-Security-Policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load appearance from the profile (fresh accounts may have an empty blob).
  const { data: profile } = await supabase
    .from("profiles")
    .select("appearance")
    .eq("id", user.id)
    .maybeSingle();

  const appearance = profile
    ? normalizeAppearance(profile.appearance)
    : DEFAULT_APPEARANCE;

  return (
    <ThemeProvider userId={user.id} initial={appearance}>
      {/* No-flash: set the feature-flag attributes on <html> before paint so a
          user who disabled a feature never sees it flash on during hydration. */}
      <script
        nonce={nonce}
        // The browser strips the `nonce` attribute from the DOM after using it
        // (security), so on hydration React sees server nonce vs. client "" and
        // warns. The script is inert post-execution (it runs once before paint),
        // so the mismatch is benign — suppress it rather than drop the nonce
        // (which the CSP requires for this inline script to run at all).
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: featureFlagScript(appearance) }}
      />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-bg">
        {/* Keyboard skip link: first focusable element, jumps past the nav. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        {/* Warm glow accents + contour texture (Appearance → Topographic
            texture; .topo-texture is hidden when [data-topo="off"]). */}
        <div
          aria-hidden
          className="topo-texture pointer-events-none absolute -left-16 -top-24 z-0 h-72 w-72 rounded-full blur-[45px]"
          style={{
            background:
              "radial-gradient(circle, rgba(200,98,45,.30), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="topo-texture pointer-events-none absolute -right-20 bottom-16 z-0 h-80 w-80 rounded-full blur-[55px]"
          style={{
            background:
              "radial-gradient(circle, rgba(122,139,82,.20), transparent 70%)",
          }}
        />

        {/* Topographic contour texture behind every screen. */}
        <svg
          aria-hidden
          className="topo-texture pointer-events-none absolute inset-0 z-0 h-full w-full opacity-[0.05]"
          viewBox="0 0 390 844"
          preserveAspectRatio="none"
        >
          <g fill="none" stroke="var(--accent)" strokeWidth="1">
            <path d="M-20 140 Q120 60 260 140 T560 140" />
            <path d="M-20 180 Q120 110 260 180 T560 180" />
            <path d="M-20 460 Q140 400 280 470 T580 460" />
            <path d="M-20 500 Q140 450 280 510 T580 500" />
            <path d="M-20 720 Q120 660 260 730 T560 720" />
          </g>
        </svg>

        {/* Scrollable screen content; space at the bottom for the nav. */}
        <main
          id="main"
          tabIndex={-1}
          className="no-scrollbar relative z-10 flex-1 overflow-y-auto overscroll-contain px-[18px] pt-2 outline-none"
          // Clear the fixed BottomNav on EVERY device: nav is 84px tall plus the
          // home-indicator safe area (env(safe-area-inset-bottom)) on notched
          // iPhones, plus a 16px gap so content never hides behind the bar.
          style={{
            paddingBottom: "calc(84px + env(safe-area-inset-bottom) + 16px)",
          }}
        >
          <ConfirmProvider>{children}</ConfirmProvider>

          {/* BottomNav lives INSIDE <main> on purpose. <main> is
              `relative z-10`, which forms a stacking context; the in-page
              bottom sheets/modals render inside {children} at z-50. If the nav
              were a sibling of <main>, its fixed z-40 would sit in the parent
              column's context and outrank main's entire z-10 subtree —
              painting the nav OVER every sheet and burying each sheet's submit
              button (you literally could not tap "Add Day"). Rendering the nav
              inside <main> puts the nav (z-40) and the sheets (z-50) in the
              SAME stacking context, so a sheet correctly paints above the nav.
              The nav stays viewport-fixed because <main> sets no containing
              block for fixed elements (overflow alone doesn't). */}
          <BottomNav />
        </main>
      </div>
    </ThemeProvider>
  );
}
