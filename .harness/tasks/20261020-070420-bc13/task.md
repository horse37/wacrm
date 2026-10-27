# Task — Wire PostgreSQL automation DELETE route

- id: `20261020-070420-bc13`
- type: `migration`
- slug: `postgres-automation-delete-route`
- status: `in_progress`

## Goal

Use the independently approved PostgreSQL automation-delete repository for `DELETE /api/automations/[id]`, retaining the existing verified server-session identity boundary.

## Context

Repository slice `20261020-055453-2a1c` has independent GPT-6 Luna `APPROVE`, zero findings/caveats, and forced-RLS PostgreSQL 16 evidence in disposable Docker Desktop. The route still deletes via the Supabase data API. The PATCH route was moved to its approved PostgreSQL repository in slice `20261020-065125-b30f`; preserve that behavior. Do not use Supabase as persistence or contact Supabase during validation.

## In scope

- Wire only DELETE to `createPostgresAutomationDeletePersistenceRepository`, using the existing verified server session as identity input and the repository's PostgreSQL account guard for membership/scope.
- Preserve the `{ ok: true }` success body and map typed repository errors to safe HTTP statuses/messages.
- Add route tests for authentication, success, error mapping, verified identity, and no Supabase data API call.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, Docker Desktop PostgreSQL 16 integration with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Out of scope

GET or any other route, UI, Auth/session-provider migration, engine/cron, schema/grant/RLS changes, Supabase persistence or network use in validation, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve every existing local change. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- `npx vitest run 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-delete-persistence.test.ts src/lib/auth/postgres-account-guard.test.ts` — route and repository behavior.
- `npx tsc --noEmit` — TypeScript.
- `npx eslint --max-warnings=0 'src/app/api/automations/[id]/route.ts' 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-delete-persistence.ts src/lib/repositories/automation-delete-persistence.test.ts` — targeted zero-warning lint.
- `npx prettier --check` on changed route, test, task, and handoff; format only the active `current-task.md` range.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-delete-persistence.ps1` — AST/fixture and disposable forced-RLS PostgreSQL proof; confirm cleanup and network isolation.
- `git diff --check` — whitespace/conflict markers.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice. Record: `.harness/tasks/20261020-070420-bc13/review-post-implementation-20261020.md`. Continue with a separate PostgreSQL GET-route slice; keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED added the DELETE route cases; the initial run failed because the handler still called the Supabase data API. DELETE now delegates to the approved PostgreSQL delete repository using only the verified server-session user ID as identity input, preserves `{ ok: true }` on success, and maps typed database errors to safe HTTP statuses/messages. GET and the approved PATCH path remain functionally unchanged. Route tests assert auth, path ID/session identity, success/error mapping, and no `supabaseAdmin` call.

Focused route/repository/account-guard Vitest passed 33/33; `npx tsc --noEmit`, targeted zero-warning ESLint, Prettier checks, the PowerShell AST/fixture checks, and `git diff --check` passed. Fresh disposable Docker Desktop PostgreSQL 16 integration passed; evidence: `.harness/tasks/20261020-055453-2a1c/validation-postgres-automation-delete-4615582349.log`. The runner used `desktop-linux`, `--network none`, tmpfs, read-only repository mounts, generated credentials, no published ports/named volumes, synthetic fixtures, forced RLS, `NOBYPASSRLS`, minimum grants, cascade/isolation checks, same-connection identity cleanup, and reported no residual task resources. No Supabase network or persistence was used.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; record: `.harness/tasks/20261020-070420-bc13/review-post-implementation-20261020.md`. This task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
