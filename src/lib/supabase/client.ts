"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (anon key). Safe to use in client components. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // New-style publishable key (sb_publishable_…), with legacy anon-key fallback.
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  );
}
