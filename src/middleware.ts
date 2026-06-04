import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Per-request security headers that do NOT contain the nonce. These mirror the
 * static set in next.config.mjs and are re-applied here so they ride along on
 * middleware-produced responses (including auth redirects), independent of the
 * Next.js header pipeline.
 */
const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
};

/**
 * Builds the Content-Security-Policy for HTML responses using a per-request
 * nonce. script-src uses the nonce + 'strict-dynamic' so the inline framework
 * bootstrap/hydration scripts and the no-flash feature-flag script (both tagged
 * with this nonce) run, and scripts they load transitively are trusted, while
 * arbitrary injected inline scripts are blocked. 'unsafe-inline' is kept in
 * script-src only as the ignored fallback for CSP1-only browsers (it is voided
 * by the presence of a nonce/'strict-dynamic' in CSP3 browsers).
 *
 * style-src keeps 'unsafe-inline' because the UI uses inline style={{…}}
 * attributes and Google Fonts CSS; img-src allows https: for user-supplied
 * avatar URLs. See next.config.mjs for the resource-allowance rationale.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // challenges.cloudflare.com: the Turnstile login captcha (gated on
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY). Listing it in script-src is the
    // fallback for browsers that ignore 'strict-dynamic'; the widget runs in
    // an iframe (frame-src) and talks home over connect-src. All three are
    // additive allowances of one trusted host, not a relaxation of the
    // existing self/nonce model.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "frame-src https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  // Per-request nonce (base64 of 16 random bytes) for the HTML CSP.
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const csp = buildCsp(nonce);

  // Expose the nonce + CSP to server components / the Next.js renderer so the
  // framework tags its inline scripts and the no-flash script can read it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, requestHeaders);

  // Apply the nonce CSP (overriding the baseline from next.config.mjs) and the
  // static security headers to whatever response updateSession returned —
  // the normal page response or an auth redirect.
  response.headers.set("Content-Security-Policy", csp);
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets / image optimization /
     * the PWA service worker + manifest.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
