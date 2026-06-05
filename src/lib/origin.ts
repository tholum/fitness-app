/**
 * The public origin of this deployment, for building absolute redirect URLs in
 * Route Handlers.
 *
 * `new URL(request.url).origin` is unreliable in a Route Handler when the app
 * runs as a Next.js standalone server behind a reverse proxy: the Web `Request`
 * URL is reconstructed from the server's own bind address (e.g. localhost:5000),
 * NOT from the forwarded Host header — so redirects built from it point users at
 * the internal address instead of the public domain. (Middleware is unaffected:
 * `request.nextUrl` there does reflect the proxied host.)
 *
 * We trust, in order:
 *   1. NEXT_PUBLIC_SITE_URL — the canonical public URL, fixed at build time.
 *      Preferred because it is not attacker-influenced (no Host-header
 *      injection / open-redirect surface) and is always correct for this
 *      deployment.
 *   2. X-Forwarded-Host (+ X-Forwarded-Proto) — set by our nginx front end, for
 *      deployments that didn't bake in a site URL.
 *   3. The request's own origin — correct in local dev, where there is no proxy.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to header / request-derived origin
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
