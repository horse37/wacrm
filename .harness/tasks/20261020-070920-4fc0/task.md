# Task — Wire PostgreSQL automation GET route

- id: `20261020-070920-4fc0`
- type: `migration`
- slug: `postgres-automation-get-route`
- status: `in_progress`

## Goal

Use the independently approved PostgreSQL automation editor repository for `GET /api/automations/[id]`, preserving the existing verified server-session identity boundary and the editor response contract.

## Context

Repository slice `20261020-014934-7b2e` has independent GPT-6 Luna `APPROVE`, zero findings/caveats, and forced-RLS PostgreSQL 16 evidence in disposable Docker Desktop. The editor page consumes only automation ID, name, description, trigger fields, active state, and nested steps, which match the repository DTO. GET still uses Supabase data APIs. The PATCH and DELETE route slices have separate slice-limited approvals; preserve both. Do not use Supabase as persistence or contact Supabase during validation.

## In scope

- Wire only GET to `createPostgresAutomationEditorRepository`, using the existing verified server session as identity input and the PostgreSQL account guard for membership/creator scope.
- Preserve the existing `{ automation, steps }` response and safe auth/not-found/database behavior.
- Add route tests for authentication, success DTO, verified identity, safe error mapping, and no Supabase data API/step-loader calls.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, Docker Desktop PostgreSQL 16 integration with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Out of scope

PATCH/DELETE or any other route, UI, Auth/session-provider migration, engine/cron, schema/grant/RLS changes, Supabase persistence or network use in validation, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve every existing local change. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- `npx vitest run 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-editor.test.ts src/lib/auth/postgres-account-guard.test.ts` — route and repository behavior.
- `npx tsc --noEmit` — TypeScript.
- `npx eslint --max-warnings=0 'src/app/api/automations/[id]/route.ts' 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-editor.ts src/lib/repositories/automation-editor.test.ts` — targeted zero-warning lint.
- `npx prettier --check` on changed route, test, task, and handoff; format only the active `current-task.md` range.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-editor.ps1` — AST/fixture checks and disposable PostgreSQL 16 proof; confirm cleanup and network isolation.
- `git diff --check` — whitespace/conflict markers.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this GET route slice. Record: `.harness/tasks/20261020-070920-4fc0/review-post-implementation-20261020.md`. Continue with a separate PostgreSQL automation-create POST route slice; keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED added the GET route cases; the initial run failed because the existing handler still invoked the Supabase data API. GET now delegates to the approved PostgreSQL automation editor repository using the verified server-session user ID as identity input, returns the repository's `{ automation, steps }` DTO, and maps typed errors to safe HTTP statuses/messages. PATCH and DELETE remain functionally unchanged. Route tests verify auth, DTO, session identity, error mapping, and that GET calls neither `supabaseAdmin` nor `loadStepsTree`.

Focused route/editor-repository/account-guard Vitest passed 46/46; `npx tsc --noEmit`, targeted zero-warning ESLint, Prettier checks, PowerShell AST/fixture validation, and `git diff --check` passed. Fresh disposable Docker Desktop PostgreSQL 16 integration passed; evidence: `.harness/tasks/20261020-014934-7b2e/validation-postgres-automation-editor-e84778fe90.log`. The runner used `desktop-linux`, `--network none`, tmpfs, read-only repository mounts, generated credentials, no published ports/named volumes, forced RLS, `NOBYPASSRLS`, exact column grants, synthetic fixtures, and confirmed no residual task resources. No Supabase persistence or validation network was used.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice; record: `.harness/tasks/20261020-070920-4fc0/review-post-implementation-20261020.md`. This task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
