import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/**
 * Baseline Content-Security-Policy applied to every response by next.config.
 *
 * HTML page responses get a *stronger* per-request CSP from src/middleware.ts
 * (a nonce + 'strict-dynamic' script-src that the inline framework/no-flash
 * scripts are tagged with). That middleware CSP overrides this one. This
 * baseline exists so that responses the middleware matcher does NOT cover —
 * static assets, the service worker (sw.js), the web app manifest — still carry
 * a restrictive CSP (defense-in-depth: clickjacking + injection coverage even
 * for non-HTML responses).
 *
 * Resource allowances reflect this app's actual loads:
 *   - Google Fonts: stylesheet from fonts.googleapis.com, font files from
 *     fonts.gstatic.com (src/app/layout.tsx).
 *   - Supabase REST/Auth over https and Realtime over wss at *.supabase.co
 *     (src/lib/supabase/*).
 *   - User-supplied avatar image URLs (https:) rendered in the account screen
 *     (src/app/(app)/account/_components.tsx).
 * Inline style attributes (style={{…}}) and Google Fonts CSS require
 * style-src 'unsafe-inline'. Static (non-HTML) responses have no inline
 * scripts, so this baseline uses a nonce-free script-src 'self'.
 */
const baselineCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Security response headers that do NOT vary per request. Applied to every
 * route. The CSP here is the baseline above; HTML responses receive the
 * nonce-based CSP from middleware instead (see note above).
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: baselineCsp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server in .next/standalone for a tiny Docker image.
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // typedRoutes: true,
  },
  async headers() {
    return [
      {
        // Every route — including static assets, sw.js and the manifest that
        // the middleware matcher deliberately skips.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSerwist(nextConfig);
