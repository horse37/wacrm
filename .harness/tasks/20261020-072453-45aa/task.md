# Task — PostgreSQL automation duplicate route

- id: `20261020-072453-45aa`
- type: `migration`
- slug: `postgres-automation-duplicate-route`
- status: `in_progress`

## Goal

Wire only `POST /api/automations/[id]/duplicate` to the approved PostgreSQL automation-duplication repository.

## Context

The duplicate persistence repository received independent GPT-6 Luna `APPROVE`, zero findings/caveats, and forced-RLS PostgreSQL 16 evidence in disposable Docker Desktop. The current duplicate route still reads/writes via Supabase admin calls and manually copies steps. Preserve the existing verified server-session auth boundary and asynchronous route params. GET list, GET editor, POST create, PATCH, and DELETE route slices have independent approvals, each limited to its route. PostgreSQL in Docker Desktop is the only persistence validation target; no Supabase persistence/network validation.

## In scope

- Wire only duplicate POST to `createPostgresAutomationDuplicatePersistenceRepository` using verified session identity and source path ID.
- Preserve 401 unauthenticated behavior, 201 `{ automation }` success shape, and safe typed error mapping.
- Add route tests for auth, path ID, verified identity, successful DTO, six typed error mappings, and no Supabase/admin/step persistence calls.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, existing disposable PostgreSQL 16 Docker validator with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, zero caveats.

## Out of scope

Any other route/UI, Auth/session migration, Supabase persistence or validation network calls, schema/grant/RLS changes, duplicate semantics/repository changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused route tests.
- `npx vitest run 'src/app/api/automations/[id]/duplicate/route.test.ts' src/lib/repositories/automation-duplicate-persistence.test.ts src/lib/auth/postgres-account-guard.test.ts` — route/repository behavior.
- `npx tsc --noEmit`; targeted ESLint with `--max-warnings=0`; Prettier check on changed files.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-duplicate-persistence.ps1` — AST/fixture checks and disposable forced-RLS PostgreSQL 16 proof; verify cleanup.
- `git diff --check` — whitespace/conflict checks.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice; record: `review-post-implementation-20261020.md`. Continue with the next separate PostgreSQL slice. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED produced seven failures because the handler still called Supabase admin `.from(...)` reads/inserts and manual step cloning. Duplicate POST now delegates to `createPostgresAutomationDuplicatePersistenceRepository` with the verified session ID and async route path ID. Existing 401 and `{ automation }`/201 response are preserved; repository errors map to safe HTTP statuses/messages. No duplicate repository, other route, or UI change.

Focused route/repository/account-guard Vitest passed 25/25. TypeScript passed; targeted ESLint passed with zero warnings; Prettier passed. Fresh disposable Docker Desktop PostgreSQL 16 validation passed; evidence: `.harness/tasks/20261020-060824-e5d4/validation-postgres-automation-duplicate-66c2668284.log`. `git diff --check` passed.

No Supabase persistence or validation network, schema/grant/RLS change, Auth/session migration, real credentials/data, app traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

Independent GPT-6 Luna review returned exact `APPROVE`, zero findings, and zero caveats, limited to duplicate POST; record: `review-post-implementation-20261020.md`. This is not approval of H-DATA-003/H-DB-003 or the full HARNESS task.
