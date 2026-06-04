import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the user out and return to the login screen. */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
