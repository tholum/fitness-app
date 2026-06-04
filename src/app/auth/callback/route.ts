import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Constrain the caller-supplied `next` to a local, same-origin path so the
 * post-login redirect can't be steered off-site. We accept only a single
 * leading slash followed by something other than `/` or `\` — this rejects
 * scheme-relative (`//evil.com`), backslash (`/\evil.com`) and userinfo
 * (`@evil.com`, which would otherwise parse as `https://app@evil.com`) tricks.
 */
function safeNext(raw: string | null): string {
  const next = raw ?? "/today";
  return /^\/(?!\/|\\)/.test(next) ? next : "/today";
}

/**
 * OAuth / PKCE + magic-link callback. Supabase redirects here with a `code`
 * we exchange for a session, then forward to `next` (default /today).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Could not sign you in. Try again.")}`,
  );
}
