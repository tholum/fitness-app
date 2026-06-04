import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the user out and return to the login screen. */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(`${origin}/login`, { status: 303 });

  // Defense-in-depth: signing out clears the Supabase session cookies, but on
  // a shared/borrowed device the PWA's on-device Cache Storage (and any other
  // client-side storage) could still hold this user's data — readable by the
  // next user via DevTools. Ask compliant browsers to purge them on sign-out.
  // The service worker (src/app/sw.ts) is configured to never cache /api/*
  // responses; this header purges anything else and covers browsers that
  // honor Clear-Site-Data even when no per-user response was cached.
  // Note: Clear-Site-Data is only honored over secure (HTTPS) origins.
  response.headers.set("Clear-Site-Data", '"cache", "storage"');

  return response;
}
