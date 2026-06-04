import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root dispatcher. Unauthenticated visitors go to /login; authenticated
 * users land on /today. This page renders nothing itself.
 */
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/today" : "/login");
}
