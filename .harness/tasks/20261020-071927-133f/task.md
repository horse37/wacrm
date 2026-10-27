# Task — PostgreSQL automation list GET route

- id: `20261020-071927-133f`
- type: `migration`
- slug: `postgres-automation-list-route`
- status: `in_progress`

## Goal

Wire only `GET /api/automations` to the approved PostgreSQL automation-list repository.

## Context

The list repository received independent GPT-6 Luna `APPROVE` with zero findings/caveats and forced-RLS PostgreSQL 16 evidence in disposable Docker Desktop. This slice starts from the dirty working tree after task `20261020-071403-9752` wired POST to PostgreSQL and received independent `APPROVE`; preserve that existing POST implementation. Existing GET uses the server-session auth boundary and reads list data through Supabase. Keep auth boundary; use PostgreSQL for persistence and Docker validation only.

## In scope

- Preserve verified server-session authentication and response shape `{ automations }`.
- Delegate GET list reads to `createPostgresAutomationListRepository`; map repository errors to safe HTTP statuses/messages.
- Add GET route tests for auth, repository identity, list DTO, safe errors, and no Supabase data API calls. Preserve POST behavior.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, existing disposable PostgreSQL 16 Docker validator with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, zero caveats.

## Out of scope

Additional changes to POST/PATCH/DELETE/duplicate routes, UI wiring, Auth/session migration, Supabase persistence or validation network calls, schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work, including the previously approved POST slice. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- `npx vitest run 'src/app/api/automations/route.test.ts' src/lib/repositories/automation-list.test.ts src/lib/auth/postgres-account-guard.test.ts` — route/repository behavior.
- `npx tsc --noEmit` — TypeScript.
- Targeted ESLint with `--max-warnings=0`; Prettier check on changed sources and task/handoff.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-list.ps1` — AST/fixture checks and disposable forced-RLS PostgreSQL 16 proof; verify cleanup.
- `git diff --check` — whitespace/conflict checks.

## Next action

Independent GPT-6 Luna read-only rereview returned exact `APPROVE`, zero findings, and zero caveats for this GET slice; record: `review-post-implementation-20261020.md`. Continue with a separate PostgreSQL automation-duplicate route slice. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED produced seven failures: the list path still called Supabase `.from('automations')` instead of the repository. GET now retains the verified server-session auth boundary and delegates listing to `createPostgresAutomationListRepository`; the DTO response remains `{ automations }`, and repository errors use safe status/message mapping. POST behavior is unchanged. Route tests cover no session, verified identity, DTO, all six typed error mappings, and no Supabase data API calls.

Focused route/repository/account-guard Vitest passed 33/33. TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed for changed source/task/handoff files. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `.harness/tasks/20261020-012732-0a44/validation-postgres-automation-list-2d30c67c70.log`. It used synthetic fixtures/generated credentials, `desktop-linux`, `--network none`, tmpfs, read-only mounts, `NOBYPASSRLS`, minimum SELECT grants, and confirmed no residual task resources. `git diff --check` passed.

No Supabase persistence or validation network was used. No route besides GET was changed in this slice. The initial reviewer reported one P2 by comparing the full dirty route to pinned HEAD and treating the prior POST task's already-present approved PostgreSQL wiring as a new change. POST wiring and its tests/review predate this slice; the only route code edit here was the GET import/handler. Do not undo the prior approved POST work. The review record explains the baseline and rereview request. No schema/grant/RLS change, Auth/session migration, real data/credentials, app traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

The baseline clarification resolved the initial reviewer finding: independent GPT-6 Luna rereview returned exact `APPROVE`, zero findings/caveats. Evidence: `review-post-implementation-20261020.md`. The POST method remains as approved by the prior task; H-DATA-003/H-DB-003 are still unapproved overall.
