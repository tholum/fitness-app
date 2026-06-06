import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SWUpdater } from "@/components/SWUpdater";

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SWUpdater />
        {children}
      </body>
    </html>
  );
}
