import type { Metadata, Viewport } from "next";
import { Oswald, Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";
import { SWUpdater } from "@/components/SWUpdater";

// Self-hosted via next/font (vs the old UA-sniffed Google Fonts <link>):
// identical, well-shaped woff2 on every device, no fallback-metric flash —
// the <link> route produced collapsed word spaces / stray intra-word gaps
// in tracked condensed labels on mobile UAs.
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const barlowCond = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cond",
});

// The nonce-based CSP (src/middleware.ts) requires every HTML response to be
// rendered per-request: Next.js only stamps the request's nonce onto its
// <script> tags during a dynamic render. Statically prerendered pages ship no
// nonce, so under 'strict-dynamic' the browser blocks ALL their scripts. The
// authed (app) routes already render dynamically (their layout reads the nonce
// via headers()), but the public routes — / and /login — sit under this root
// layout, so we force dynamic rendering here to cover them and any future
// public page. Without this, /login loads with every script CSP-blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Path Warden",
  description: "The path is narrow. Let's stand watch together.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Path Warden" },
};

export const viewport: Viewport = {
  themeColor: "#1c1a17",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${oswald.variable} ${barlow.variable} ${barlowCond.variable}`}
    >
      <body>
        <SWUpdater />
        {children}
      </body>
    </html>
  );
}
