export const meta = {
  name: 'basecamp-review-fix',
  description: 'Multi-perspective review of the BASECAMP app, then apply every fix and re-verify',
  phases: [
    { title: 'Review', detail: 'parallel reviewers: RLS/security, Next15, types/build, data, design, a11y/PWA' },
    { title: 'Fix', detail: 'apply all findings, partitioned by file (no conflicts)' },
    { title: 'Verify', detail: 'install (2-day cooldown), typecheck, build until green' },
  ],
}

const ROOT = '/Users/timholum/Projects/FitnessApp_Claude'

const CTX = `
You are reviewing BASECAMP, a Next.js 15 (App Router) + TypeScript + Tailwind + Supabase PWA at ${ROOT}.
It is a completion-first MTNTOUGH training tracker with a COOPERATIVE crew layer (shared goals, feed,
reactions, nudges — NO competitive leaderboard/ranking).
Orient yourself by reading: PROJECT-PLAN.md, src/app/globals.css, tailwind.config.ts,
supabase/migrations/0001_init.sql, and design-prototypes/variant-4-basecamp/index.html (the visual target).
Conventions: "@/..." alias = src/...; style only via token classes (bg-surface, text-text, text-muted,
bg-accent, rounded-card, font-display, bg-grad …); browser supabase client "@/lib/supabase/client",
async server client "@/lib/supabase/server". The publishable key env is
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (fallback NEXT_PUBLIC_SUPABASE_ANON_KEY).
`

const FINDINGS = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'exact repo-relative path, or "general" if cross-cutting' },
          issue: { type: 'string' },
          fix: { type: 'string', description: 'concrete change to make' },
        },
        required: ['severity', 'file', 'issue', 'fix'],
      },
    },
  },
  required: ['findings'],
}

// ───────────────────────── Phase 1: Review ─────────────────────────
phase('Review')

const REVIEWERS = [
  { key: 'security-rls', prompt: `${CTX}
REVIEW DIMENSION: Security & Row-Level Security. Scrutinize supabase/migrations/0001_init.sql AND how the
app uses Supabase. Check: every table has RLS enabled + correct policies; no data leaks across users;
crew visibility helpers (shares_crew/is_crew_member) are SECURITY DEFINER and don't cause recursive RLS;
body_metrics/nutrition/water are strictly private; PRs/feed/reactions/nudges scoped to crew; the
handle_new_user trigger is safe (search_path set); no secret key used client-side; publishable key only.
Report concrete findings.` },
  { key: 'next15', prompt: `${CTX}
REVIEW DIMENSION: Next.js 15 App Router correctness. Check every file under src/app and src/components for:
correct server vs client component boundaries ("use client" present wherever hooks/state/events/browser
APIs are used; absent on pure server components); server createClient() is awaited everywhere; route
handlers (auth/callback, confirm, signout) correct for @supabase/ssr; middleware matcher sane; server
actions ("use server") correct with revalidatePath; no importing server-only code into client. Report findings.` },
  { key: 'types-build', prompt: `${CTX}
REVIEW DIMENSION: TypeScript & buildability. Check imports resolve, @/ paths correct, types in src/lib/types.ts
match the migration columns exactly, no obvious type errors, no use of removed APIs, JSX/props typed,
no missing exports that screens import. Predict what 'pnpm typecheck' / 'pnpm build' would fail on and how to fix.` },
  { key: 'data', prompt: `${CTX}
REVIEW DIMENSION: Data layer correctness. Check src/lib/queries.ts and src/lib/actions.ts: table and column
names EXACTLY match supabase/migrations/0001_init.sql; queries are RLS-compatible; selects/inserts/updates
target real columns; graceful handling of empty results; actions revalidate the right paths; crew/feed/nudge
logic matches cooperative model. Report findings.` },
  { key: 'design', prompt: `${CTX}
REVIEW DIMENSION: Design fidelity & UX. Compare each screen (src/app/(app)/*) to the BASECAMP prototype:
SUMMIT palette via tokens (no stray hardcoded hex outside SVGs), FORGE layout (hero card, rings, FAB nav,
badges), condensed Oswald display type, rounded cards, gradient accents. Crew screen must be COOPERATIVE
(shared goal, "X of N trained today", supportive statuses + nudges) — flag ANY competitive ranking. Phone-width
column centered on desktop. Report findings.` },
  { key: 'a11y-pwa', prompt: `${CTX}
REVIEW DIMENSION: Accessibility & PWA. Check: buttons/inputs have accessible names/labels; sufficient tap
targets; images/svgs have appropriate alt/aria; focus states; color contrast on the dark theme; manifest.webmanifest
valid (name, icons 192/512 + maskable, theme_color, start_url /today, display standalone); sw.ts matches
next.config swSrc and uses self.__SW_MANIFEST; icons referenced exist (or are clearly placeholders). Report findings.` },
]

const reviews = await parallel(REVIEWERS.map(r => () =>
  agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS })))

// flatten + keep everything ("fix everything they say")
const all = reviews.filter(Boolean).flatMap(r => r.findings || [])
log(`Collected ${all.length} findings across ${REVIEWERS.length} reviewers.`)

// group by file so each fixer owns disjoint files (no write conflicts)
const byFile = {}
for (const f of all) {
  const key = f.file && f.file !== 'general' ? f.file : '__general__'
  ;(byFile[key] ||= []).push(f)
}
const groups = Object.entries(byFile)
log(`Grouped into ${groups.length} file buckets to fix.`)

// ───────────────────────── Phase 2: Fix ─────────────────────────
phase('Fix')

const order = { blocker: 0, high: 1, medium: 2, low: 3 }
const fixes = await parallel(groups.map(([file, fs]) => () => {
  const list = fs.sort((a, b) => order[a.severity] - order[b.severity])
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.issue}\n   FIX: ${f.fix}`).join('\n')
  const target = file === '__general__'
    ? 'These are cross-cutting findings; locate and fix the relevant files.'
    : `Fix this file: ${file} (edit related files only if strictly required to resolve a finding).`
  return agent(`${CTX}
You are a fix agent. ${target}
Apply ALL of the following findings. Make minimal, correct edits that preserve the BASECAMP look and the
cooperative-crew model. Do not introduce new dependencies. After editing, re-read your changes to confirm
they are syntactically valid.

FINDINGS:
${list}

Report exactly what you changed (file + summary per finding).`,
    { label: `fix:${file === '__general__' ? 'general' : file.split('/').pop()}`, phase: 'Fix' })
}))

// ───────────────────────── Phase 3: Verify ─────────────────────────
phase('Verify')

const verify = await agent(`${CTX}
FINAL VERIFICATION. You MAY edit any file. Steps (report output of each):
 1. cd ${ROOT}; enable pnpm via corepack (corepack enable && corepack prepare pnpm@10.18.0 --activate).
 2. pnpm install  (respects minimumReleaseAge: 2880 — do NOT disable it). If the network is unavailable,
    say so clearly and fall back to a thorough static pass: read all changed files and fix any remaining
    type/import/boundary errors by inspection.
 3. If install worked: run 'pnpm typecheck' then 'pnpm build'; fix every error and re-run until both pass.
    Ensure pnpm-lock.yaml exists for the Docker frozen install.
Report: commands run, pass/fail, fixes applied, and any remaining manual steps for the user. Be honest about
what is and isn't verified.`,
  { label: 'verify', phase: 'Verify' })

return {
  totalFindings: all.length,
  bySeverity: all.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}),
  fileBuckets: groups.length,
  fixes: fixes.map(Boolean),
  verify,
}
