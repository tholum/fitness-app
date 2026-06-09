/* ════════════════════════════════════════════════════════════════════
   UI GALLERY — populated-account provisioning.

   Sets a known local dev password on the "populated" account directly in the
   LOCAL Supabase Postgres (via pgcrypto), so the populated capture pass needs
   no human-entered secret. Uses the `psql` CLI to avoid adding a Postgres
   client dependency. HARD REFUSES to run against a non-local database.
   ════════════════════════════════════════════════════════════════════ */

import { execFileSync } from "node:child_process";
import { DB_URL, POPULATED_EMAIL, POPULATED_PASSWORD } from "./config";

/** True only for loopback hosts — the guard that keeps this off any real DB. */
export function isLocalDbUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Idempotently set `password` on `email` in the local auth.users table. Safe to
 * re-run. Returns true only when the account exists and was updated.
 * email/password are project-controlled constants (not user input); we still
 * keep them simple (no quotes) so inlining into SQL is safe.
 */
export function ensurePopulatedPassword(
  email: string = POPULATED_EMAIL,
  password: string = POPULATED_PASSWORD,
  dbUrl: string = DB_URL,
): boolean {
  if (!isLocalDbUrl(dbUrl)) {
    process.stderr.write(`   ✋ refusing to set a password on a non-local DB (${dbUrl}).\n`);
    return false;
  }
  if (/['\\;]/.test(email) || /['\\;]/.test(password)) {
    process.stderr.write("   ✋ email/password contain unsafe characters for inline SQL.\n");
    return false;
  }
  const sql =
    `update auth.users ` +
    `set encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf')), updated_at = now() ` +
    `where email = '${email}'; ` +
    `select case when exists(select 1 from auth.users where email = '${email}') then 'ok' else 'missing' end;`;
  try {
    const out = execFileSync("psql", [dbUrl, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.includes("ok");
  } catch (err) {
    process.stderr.write(`   ✋ psql password update failed: ${(err as Error).message}\n`);
    return false;
  }
}
