import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import {
  ThemeProvider,
  normalizeAppearance,
  DEFAULT_APPEARANCE,
} from "@/components/ThemeProvider";

/**
 * Authenticated app shell. Guards every (app) route, loads the user's
 * appearance preferences, and renders the BASECAMP phone-style column
 * (centered, max ~430px) with the fixed bottom navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-bg">
        {/* Warm glow accents, mirroring the prototype's phone bezel lighting. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-24 z-0 h-72 w-72 rounded-full blur-[45px]"
          style={{
            background:
              "radial-gradient(circle, rgba(200,98,45,.30), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 bottom-16 z-0 h-80 w-80 rounded-full blur-[55px]"
          style={{
            background:
              "radial-gradient(circle, rgba(122,139,82,.20), transparent 70%)",
          }}
        />

        {/* Topographic contour texture behind every screen. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-[0.05]"
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
        <main className="no-scrollbar relative z-10 flex-1 overflow-y-auto px-[18px] pb-[100px] pt-2">
          {children}
        </main>

        <BottomNav />
      </div>
    </ThemeProvider>
  );
}
