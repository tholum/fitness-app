export const meta = {
  name: 'basecamp-security',
  description: 'Adversarial security audit of the BASECAMP app, confirm findings, remediate, re-verify',
  phases: [
    { title: 'Audit', detail: 'parallel attackers: RLS, auth/session, secrets, injection/XSS, deps, infra' },
    { title: 'Confirm', detail: 'adversarially verify each finding is real (kill false positives)' },
    { title: 'Remediate', detail: 'fix confirmed vulns, grouped by file' },
    { title: 'Verify', detail: 'install (2-day cooldown), pnpm audit, typecheck, build' },
  ],
}

const ROOT = '/Users/timholum/Projects/FitnessApp_Claude'

const CTX = `
You are performing a SECURITY review of BASECAMP, a Next.js 15 (App Router) + TypeScript + Supabase PWA at
${ROOT}. It is a completion-first MTNTOUGH tracker with a cooperative crew (shared feed, reactions, nudges).
THREAT MODELS to assume:
  (A) an anonymous unauthenticated attacker hitting the app + Supabase REST/Realtime directly with the
      publishable key;
  (B) an authenticated but MALICIOUS user trying to read/modify other users' data or other crews' data;
  (C) a malicious crew-mate trying to exceed what cooperative membership should allow.
Read to orient: supabase/migrations/0001_init.sql (RLS is the primary defense — Supabase tables are
reachable directly via the anon/publishable key, so RLS must hold on its own), src/middleware.ts,
src/lib/supabase/*, src/lib/actions.ts, src/lib/queries.ts, src/app/auth/*, next.config.mjs, Dockerfile,
.env.example, .gitignore. Remember: the publishable key ships to the browser by design — security cannot
depend on it being secret; it MUST come from RLS + server-side checks.
`

const VULNS = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          title: { type: 'string' },
          file: { type: 'string', description: 'exact repo-relative path, or "general"' },
          threatModel: { type: 'string', enum: ['A-anon', 'B-malicious-user', 'C-crew-mate', 'other'] },
          exploit: { type: 'string', description: 'concrete exploit / attack scenario' },
          remediation: { type: 'string', description: 'specific fix' },
        },
        required: ['severity', 'title', 'file', 'exploit', 'remediation'],
      },
    },
  },
  required: ['findings'],
}

// ───────────────────────── Phase 1: Audit ─────────────────────────
phase('Audit')

const AUDITORS = [
  { key: 'rls', prompt: `${CTX}
ATTACK SURFACE: Row-Level Security & direct data access. Go table-by-table in 0001_init.sql. For EACH table
and EACH operation (select/insert/update/delete) ask: can attacker (A), (B), or (C) do something they
shouldn't? Look for: tables with RLS enabled but missing a needed policy (default-deny may break the app OR a
permissive policy may leak); USING vs WITH CHECK gaps (e.g. update that lets you reassign user_id/crew_id to
escalate); the shares_crew/is_crew_member SECURITY DEFINER functions (search_path pinned? can they be abused?
recursive RLS?); whether body_metrics/nutrition/water are truly private; whether feed/reactions/nudges/prs are
correctly crew-scoped; whether a user can insert a feed_post for a crew they don't belong to, react/nudge across
crews, or join an arbitrary crew via crew_members insert; INSERT policies that forget to bind user_id=auth.uid().
Report concrete findings with exploit + remediation.` },
  { key: 'auth', prompt: `${CTX}
ATTACK SURFACE: Authentication, session, and routing. Check: src/app/auth/callback + confirm for OPEN REDIRECT
(unvalidated ?next/redirect param), session fixation, missing exchangeCodeForSession error handling; magic-link
flow (emailRedirectTo restricted to our origin); middleware matcher actually protects every authed route (can a
protected page be reached unauthenticated? are server actions/route handlers independently authorized, not relying
only on middleware?); cookie flags via @supabase/ssr; signout is POST + clears session; no auth bypass.
Report findings with exploit + remediation.` },
  { key: 'secrets', prompt: `${CTX}
ATTACK SURFACE: Secrets & configuration. Verify NO secret-tier key (sb_secret_… / service_role) is referenced in
any NEXT_PUBLIC_ var or any client component; .gitignore excludes .env*.local and no real secrets are committed;
Dockerfile build args don't bake secrets into the image layers/bundle; env vars are read safely; .env.example
contains only placeholders. Confirm the app's security does not rely on the publishable key being secret.
Report findings.` },
  { key: 'injection', prompt: `${CTX}
ATTACK SURFACE: Injection, XSS, SSRF, output safety. Look for: dangerouslySetInnerHTML / unsanitized rendering of
user-generated content (feed post body, notes, display_name) → stored XSS; unvalidated inputs in server actions
(src/lib/actions.ts) — missing bounds/type checks, mass-assignment (trusting client-supplied user_id/crew_id);
any raw SQL / .rpc with string interpolation; SSRF or reverse-tabnabbing via external links (video_url / "Watch on
MTNTOUGH" anchors must use rel="noopener noreferrer" and validate the URL scheme/host). Report findings.` },
  { key: 'deps', prompt: `${CTX}
ATTACK SURFACE: Dependencies & supply chain. Inspect package.json + (if present) pnpm-lock.yaml. Confirm the
2-day cooldown (minimumReleaseAge: 2880, minutes) is set in pnpm-workspace.yaml. Try 'corepack enable && pnpm audit
--prod' (and full audit) — report vulnerable transitive deps and the safe upgrade respecting the cooldown. Flag any
dependency with install/postinstall scripts that look risky, typosquat-looking names, or unpinned majors. If network
is unavailable, say so and review statically. Report findings.` },
  { key: 'infra', prompt: `${CTX}
ATTACK SURFACE: Infra, headers, Docker. Check the Dockerfile (runs as non-root? no secrets in layers? minimal
image?); next.config.mjs for missing SECURITY HEADERS (recommend a headers() block: Content-Security-Policy,
X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security,
Permissions-Policy); PWA service worker scope; any debug/telemetry leakage; rate-limiting considerations for
auth + nudges. Report findings with concrete remediations (incl. a suggested CSP compatible with Supabase + the
Google Fonts the app loads).` },
]

// VERDICT schema for adversarial confirmation of each finding.
const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    reasoning: { type: 'string' },
  },
  required: ['real', 'severity', 'reasoning'],
}

// PIPELINE — no barrier between Audit and Confirm. Each auditor's findings are
// adversarially confirmed the instant that auditor returns (fast auditors don't
// wait for the slowest), and confirmations within an auditor fan out too.
const perAuditor = await pipeline(
  AUDITORS,
  (a) => agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: VULNS }),
  async (res, a) => {
    const fs = (res && res.findings) || []
    const checked = await parallel(fs.map(f => () =>
      agent(`${CTX}
Adversarially verify this reported finding by reading the actual code/migration. Is it REAL and exploitable, or a
false positive? Default to real=false if you cannot demonstrate it. Re-rate severity if needed.
FINDING: [${f.severity}] ${f.title}
FILE: ${f.file}
EXPLOIT CLAIM: ${f.exploit}
PROPOSED FIX: ${f.remediation}`,
        { label: `confirm:${a.key}:${(f.title || 'finding').slice(0, 20)}`, phase: 'Confirm', schema: VERDICT })
        .then(v => (v && v.real ? { ...f, severity: v.severity, reasoning: v.reasoning } : null))))
    return { candidates: fs.length, confirmed: checked.filter(Boolean) }
  },
)

const candidates = perAuditor.filter(Boolean).reduce((n, r) => n + r.candidates, 0)
const confirmed = perAuditor.filter(Boolean).flatMap(r => r.confirmed)
log(`Confirmed ${confirmed.length} of ${candidates} candidate findings (pipelined audit→confirm across ${AUDITORS.length} surfaces).`)

// group confirmed vulns by file for conflict-free remediation
const byFile = {}
for (const f of confirmed) {
  const k = f.file && f.file !== 'general' ? f.file : '__general__'
  ;(byFile[k] ||= []).push(f)
}
const groups = Object.entries(byFile)

// ───────────────────────── Phase 3: Remediate ─────────────────────────
phase('Remediate')

const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const remediations = await parallel(groups.map(([file, fs]) => () => {
  const list = fs.sort((a, b) => order[a.severity] - order[b.severity])
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.title}\n   EXPLOIT: ${f.exploit}\n   FIX: ${f.remediation}`).join('\n')
  const target = file === '__general__'
    ? 'Cross-cutting; locate and fix the relevant files (and add a new migration a new highest-numbered migration (list supabase/migrations/ and pick the next free index, e.g. supabase/migrations/0003_security.sql) for any RLS/policy changes — do NOT edit 0001_init.sql in place since it may already be applied).'
    : `Remediate ${file}. For RLS/policy changes, ADD a new migration a new highest-numbered migration (list supabase/migrations/ and pick the next free index, e.g. supabase/migrations/0003_security.sql) rather than editing 0001_init.sql in place.`
  return agent(`${CTX}
You are a security remediation engineer. ${target}
Apply ALL confirmed findings below with minimal, correct changes that preserve app behavior and the BASECAMP look
+ cooperative-crew model. Prefer defense-in-depth (fix RLS AND add server-side authorization checks where relevant).
Do not weaken any existing control. Report exactly what you changed per finding.

CONFIRMED FINDINGS:
${list}`,
    { label: `fix:${file === '__general__' ? 'general' : file.split('/').pop()}`, phase: 'Remediate' })
}))

// ───────────────────────── Phase 4: Verify ─────────────────────────
phase('Verify')

const verify = await agent(`${CTX}
FINAL VERIFICATION after remediation (you MAY edit any file). Report each step's output:
 1. cd ${ROOT}; corepack enable && corepack prepare pnpm@10.18.0 --activate.
 2. pnpm install (respect minimumReleaseAge: 2880 — never disable). If offline, say so + static review.
 3. pnpm audit (report residual advisories + whether a cooldown-respecting fix exists).
 4. pnpm typecheck && pnpm build — fix any errors introduced by remediation; re-run until green.
 5. If you added a new highest-numbered migration (list supabase/migrations/ and pick the next free index, e.g. supabase/migrations/0003_security.sql), sanity-check the SQL parses logically and note that the
    user must run 'pnpm db:push' to apply it.
Report: commands, pass/fail, residual risks, and required manual steps. Be honest about what is verified.`,
  { label: 'verify', phase: 'Verify' })

return {
  candidates,
  confirmed: confirmed.length,
  bySeverity: confirmed.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}),
  fileBuckets: groups.length,
  verify,
}
