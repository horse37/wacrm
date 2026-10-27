# Task — Wire PostgreSQL automation PATCH route

- id: `20261020-065125-b30f`
- type: `migration`
- slug: `postgres-automation-patch-route`

## Goal

Use the approved PostgreSQL automation update repository for `PATCH /api/automations/[id]`, so automation data reads/writes in this handler are PostgreSQL-backed and atomic.

## Context

The repository slice `20261020-064000-9c8d` has independent GPT-6 Luna `APPROVE` and passed focused PostgreSQL 16 integration in disposable Docker Desktop. The current handler still performs ownership/read/update/step replacement through separate Supabase data API calls. Keep the existing verified server-session boundary; do not use Supabase as the persistence store or contact Supabase in validation.

## In scope

- Wire only `PATCH` to `createPostgresAutomationUpdatePersistenceRepository`, deriving identity only from the already verified server session and the PostgreSQL account guard.
- Remove Supabase data API operations from the PATCH path and preserve request parsing, success shape, safe status mapping, and activation validation behavior.
- Add route tests for authentication, invalid JSON, repository success/failure mapping, and that PATCH does not call Supabase data APIs.
- Run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, Docker Desktop PostgreSQL 16 integration with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Out of scope

GET/DELETE or other automation routes, UI, Auth/session-provider migration, automation engine/cron, schema/grant/RLS changes, Supabase persistence or network use in validation, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve every existing local change. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- `npx vitest run 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-update-persistence.test.ts src/lib/auth/postgres-account-guard.test.ts` — 28/28 passed.
- `npx tsc --noEmit` — TypeScript.
- `npx eslint --max-warnings=0 'src/app/api/automations/[id]/route.ts' 'src/app/api/automations/[id]/route.test.ts' src/lib/repositories/automation-update-persistence.ts src/lib/repositories/automation-update-persistence.test.ts` — zero-warning lint.
- `npx prettier --check` on the changed route, route test, repository, repository test, task, and handoff — formatting.
- `npx prettier --check --range-start 0 --range-end <updated-header-offset> .harness/current-task.md` — formatting of the changed active-task block without reformatting historical snapshots.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-update-persistence.ps1` — AST/fixture checks and disposable PostgreSQL 16 proof; confirm its Docker execution uses network isolation and leaves no resources.
- `git diff --check` — whitespace/conflict markers.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice; record: `.harness/tasks/20261020-065125-b30f/review-post-implementation-20261020.md`. Continue with a separate PostgreSQL route-integration slice. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED added route cases; two failed because the existing handler still called the Supabase data client. PATCH now verifies the existing server session, passes its user ID to the PostgreSQL account guard, and delegates the parsed body to `createPostgresAutomationUpdatePersistenceRepository`. PATCH no longer calls Supabase data APIs or step-tree read/write helpers; GET and DELETE remain unchanged. Repository activation validation now exposes its issue list through a typed error so the route preserves the editor's existing 400 response and issue details. Safe repository errors map to 401/403/400/404/409/500. The existing server-session verifier remains the authentication boundary; tests mock it and make no Supabase network calls.

Focused route/repository/account-guard Vitest passed 28/28; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. The existing repository's disposable Docker Desktop PostgreSQL 16 integration was rerun and passed with forced RLS, `NOBYPASSRLS`, minimum grants, synthetic fixtures, generated credentials, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual resources. Repository evidence: `.harness/tasks/20261020-064000-9c8d/validation-postgres-automation-update-30cd33c76e.log`; HTTP route behavior is covered by mocked route tests. An earlier Docker attempt stopped before SQL execution because Node strip-only mode rejected a TypeScript parameter property; replacing it with an explicit class field fixed compatibility. Failed run retained at `.harness/tasks/20261020-064000-9c8d/validation-postgres-automation-update-7cebaae14d.log`.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice only; record: `.harness/tasks/20261020-065125-b30f/review-post-implementation-20261020.md`. This task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
