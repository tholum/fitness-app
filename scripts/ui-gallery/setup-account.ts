/* ════════════════════════════════════════════════════════════════════
   UI GALLERY — one-shot account setup (pnpm ui:setup).

   (Re)sets the known local dev password on the populated account so the
   populated capture pass works with no secret. The capture also does this
   automatically on a failed populated login, so this command is only needed
   if you want to set it up ahead of time or after a db reset.
   ════════════════════════════════════════════════════════════════════ */

import { DB_URL, POPULATED_EMAIL, POPULATED_PASSWORD } from "./config";
import { ensurePopulatedPassword } from "./provision";

const ok = ensurePopulatedPassword();
if (ok) {
  process.stdout.write(
    `\n✅ Local dev password set on ${POPULATED_EMAIL}.\n` +
      `   The populated pass now works with no .env — default password "${POPULATED_PASSWORD}".\n\n`,
  );
  process.exit(0);
} else {
  process.stderr.write(
    `\n❌ Couldn't set the password (DB: ${DB_URL}).\n` +
      `   Check that local Supabase is running, that ${POPULATED_EMAIL} exists,\n` +
      `   and that GALLERY_DB_URL points at your local stack.\n\n`,
  );
  process.exit(1);
}
