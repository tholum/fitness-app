import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** One cookie as handed to `setAll` by @supabase/ssr. */
type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *
 * `requestHeaders` are forwarded onto the (possibly recreated) response request
 * so values set by the caller — notably the per-request CSP nonce — reach the
 * server components / framework. See src/middleware.ts for the nonce wiring.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
) {
  const headers = requestHeaders ?? request.headers;
  let supabaseResponse = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request: { headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated users are redirected to /login (except auth + public assets).
  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname === "/";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
