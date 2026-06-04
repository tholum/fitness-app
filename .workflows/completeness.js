export const meta = {
  name: 'basecamp-completeness',
  description: 'Audit every page for functional gaps, then build the missing management features',
  phases: [
    { title: 'Audit', detail: 'per-domain reviewers: can a real user run & manage everything?' },
    { title: 'Plan', detail: 'synthesize gaps into an ordered, conflict-free build plan' },
    { title: 'Build', detail: 'implement missing must-have features (+ migration if needed)' },
    { title: 'Verify', detail: 'install (2-day cooldown), typecheck, build until green' },
  ],
}

const ROOT = '/Users/timholum/Projects/FitnessApp_Claude'

const CTX = `
BASECAMP is a Next.js 15 (App Router) + TS + Tailwind + Supabase PWA at ${ROOT}: a completion-first MTNTOUGH
training tracker with body/nutrition logging and a COOPERATIVE crew (shared goals, feed, reactions, nudges — no
ranking). Orient by reading: PROJECT-PLAN.md, design-prototypes/variant-4-basecamp/index.html, src/app/globals.css,
tailwind.config.ts, supabase/migrations/0001_init.sql, and everything under src/app and src/lib.
Conventions: "@/..."=src/...; style via token classes (bg-surface, text-text, text-muted, bg-accent, rounded-card,
font-display, bg-grad …); browser client "@/lib/supabase/client", async server client "@/lib/supabase/server";
publishable key env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.

GOAL OF THIS STAGE: make the app something a real user can FULLY run and MANAGE end-to-end — not just view.
Especially: the user explicitly needs to be able to ADD/EDIT EXERCISES, PROGRAMS, and PLANS (authoring/management),
not only follow a seeded one.
`

const GAPS = {
  type: 'object', additionalProperties: false,
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          area: { type: 'string' },
          capability: { type: 'string', description: 'the thing a user CANNOT currently do but needs to' },
          severity: { type: 'string', enum: ['blocker', 'important', 'nice'] },
          detail: { type: 'string', description: 'what is missing / broken, with file refs' },
          proposedFix: { type: 'string', description: 'concrete page/action/table to add' },
          needsSchema: { type: 'boolean' },
        },
        required: ['area', 'capability', 'severity', 'detail', 'proposedFix', 'needsSchema'],
      },
    },
  },
  required: ['gaps'],
}

// ───────────────────────── Phase 1: Audit ─────────────────────────
phase('Audit')

const LENSES = [
  { key: 'program-exercise-mgmt', prompt: `${CTX}
AUDIT: Program / exercise / plan MANAGEMENT (the user's top concern). Determine whether a user can:
create a program; add/edit/delete phases, weeks, days; add/edit/reorder/delete blocks AND individual exercises;
maintain a reusable EXERCISE LIBRARY; set video links (MTNTOUGH deep links); upload/import a plan (desktop-first);
assign/enroll into a program and pick "today's" day. The 0001 schema has programs/program_days/program_blocks but
likely NO exercise library, NO enrollment, and NO management UI. Report every gap that blocks "add exercises and
manage plans", with concrete proposedFix (pages under src/app, actions, and any new tables).` },
  { key: 'logging-crud', prompt: `${CTX}
AUDIT: Logging completeness + lifecycle. For sessions/blocks, body metrics, nutrition meals, water, PRs — can the
user CREATE, EDIT, and DELETE entries (not just see seeded values)? Are there real forms wired to actions, or static
markup? Can you log a meal, add water, record weight, set a PR, edit a mistake? Report gaps with proposedFix.` },
  { key: 'crew-lifecycle', prompt: `${CTX}
AUDIT: Crew lifecycle. Can a user with NO crew create one, and others JOIN via invite code? Can you view members,
leave a crew, switch between multiple crews, post to the feed, react, and send/receive nudges for real (wired to
actions)? Is there an onboarding path when crewless? Report gaps + proposedFix.` },
  { key: 'navigation-account', prompt: `${CTX}
AUDIT: Navigation, account & first-run. Every bottom-nav + gear target resolves (no dead links/404s)? Is there a
profile/account screen (edit display name, avatar, sign out reachable)? First-run/onboarding for a brand-new user
with an empty DB (no program, no crew, no logs) — can they get oriented and pick a program? Are empty states present
on every screen? Report gaps + proposedFix.` },
  { key: 'end-to-end', prompt: `${CTX}
AUDIT: End-to-end journeys. Trace concretely: (1) sign up → land somewhere useful → select/create a program →
see Today; (2) open Today → Check In → tick blocks → mark complete → it persists and shows on Progress;
(3) create crew → invite → a completion appears in the feed → react/nudge; (4) log body+nutrition → see it reflected.
For each journey list the exact step that breaks or is missing. Report gaps + proposedFix.` },
]

const audits = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `audit:${l.key}`, phase: 'Audit', schema: GAPS })))

const gaps = audits.filter(Boolean).flatMap(r => r.gaps || [])
log(`Found ${gaps.length} candidate gaps. Blockers: ${gaps.filter(g => g.severity === 'blocker').length}, important: ${gaps.filter(g => g.severity === 'important').length}.`)

// ───────────────────────── Phase 2: Plan (barrier) ─────────────────────────
phase('Plan')

const PLAN = {
  type: 'object', additionalProperties: false,
  properties: {
    migration: {
      type: 'object', additionalProperties: false,
      properties: {
        needed: { type: 'boolean' },
        filename: { type: 'string', description: 'e.g. supabase/migrations/0002_features.sql' },
        sql: { type: 'string', description: 'full SQL incl. tables, RLS enable + policies, indexes' },
      },
      required: ['needed'],
    },
    tasks: {
      type: 'array',
      description: 'ordered build tasks with DISJOINT file sets so they can run in parallel without conflict',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          spec: { type: 'string', description: 'precise what-to-build, referencing any new tables by name' },
        },
        required: ['title', 'files', 'spec'],
      },
    },
  },
  required: ['migration', 'tasks'],
}

const plan = await agent(`${CTX}
You are the planner. Below are gaps found by the audit. Produce a CONCRETE, ordered build plan that closes every
'blocker' and 'important' gap (skip 'nice' unless trivial). Rules:
 - If new tables are needed (very likely: an exercises library, program enrollment/assignment, maybe set/rep detail),
   put ALL schema in ONE new migration: list supabase/migrations/ and use the next free index (e.g.
   supabase/migrations/0002_features.sql). Provide complete SQL: tables, "alter table … enable row level security",
   and correct RLS policies consistent with 0001 (owner-writes; crew-cooperative; private body/nutrition), plus indexes.
 - Define build tasks with DISJOINT 'files' lists (no two tasks edit the same file) so they run in parallel safely.
   The migration is written separately — feature tasks may ASSUME the new tables exist and reference them by name.
 - Keep tasks minimal but sufficient; match the BASECAMP look and cooperative-crew model. Prefer reusing
   src/components/ui.tsx primitives and adding actions to src/lib/actions.ts ONLY if you assign that file to exactly
   one task. Aim for <= 8 tasks.

GAPS:
${gaps.map((g, i) => `${i + 1}. [${g.severity}] (${g.area}) ${g.capability}\n   detail: ${g.detail}\n   fix: ${g.proposedFix}\n   needsSchema: ${g.needsSchema}`).join('\n')}`,
  { label: 'plan', phase: 'Plan', schema: PLAN })

log(`Plan: ${plan.tasks.length} tasks; migration ${plan.migration?.needed ? 'YES → ' + (plan.migration.filename || '0002_features.sql') : 'no'}.`)

// ───────────────────────── Phase 3: Build ─────────────────────────
phase('Build')

const schemaSql = plan.migration?.needed ? (plan.migration.sql || '') : ''
const migFile = plan.migration?.filename || 'supabase/migrations/0002_features.sql'

const buildThunks = []

// 3a. migration first-class task (distinct file → safe in parallel)
if (plan.migration?.needed && schemaSql) {
  buildThunks.push(() => agent(`${CTX}
Create the new migration file ${migFile} with EXACTLY this SQL (review it for validity, fix obvious SQL errors,
ensure every new table has RLS enabled with correct policies matching 0001's model, then write the file):

${schemaSql}

Report the final file contents summary.`, { label: `build:migration`, phase: 'Build' }))
}

// 3b. feature tasks (disjoint files per the plan)
for (const t of plan.tasks) {
  buildThunks.push(() => agent(`${CTX}
BUILD TASK: ${t.title}
Create/edit ONLY these files: ${t.files.join(', ')}
Spec: ${t.spec}

${schemaSql ? `New tables available (migration ${migFile}) — reference them by the names defined here:\n${schemaSql}\n` : ''}
Match the BASECAMP design system (tokens, Oswald display type, rounded cards, gradient accents) and the cooperative
crew model. Wire forms to server actions; handle empty + loading states. Use "use client" only where needed and
await the async server createClient(). Report exactly what you created/changed.`,
    { label: `build:${t.title.slice(0, 24)}`, phase: 'Build' }))
}

const built = await parallel(buildThunks)

// ───────────────────────── Phase 4: Verify ─────────────────────────
phase('Verify')

const verify = await agent(`${CTX}
FINAL VERIFICATION (you MAY edit any file). Report each step:
 1. cd ${ROOT}; corepack enable && corepack prepare pnpm@10.18.0 --activate.
 2. pnpm install (respect minimumReleaseAge: 2880 — never disable). If offline, say so + do a thorough static pass.
 3. pnpm typecheck && pnpm build — fix every error from the new features; re-run until green. Ensure new routes
    resolve and nav links point to real pages (no 404s).
 4. Confirm the new ${migFile ? migFile : 'migration'} SQL parses logically; note the user must run 'pnpm db:push'.
Report: commands, pass/fail, what was added, residual gaps, and required manual steps. Be honest about what's verified.`,
  { label: 'verify', phase: 'Verify' })

return {
  gapsFound: gaps.length,
  bySeverity: gaps.reduce((m, g) => ((m[g.severity] = (m[g.severity] || 0) + 1), m), {}),
  migration: plan.migration?.needed ? migFile : null,
  tasksBuilt: plan.tasks.map(t => t.title),
  verify,
}
