# Task — Wire PostgreSQL automation POST route

- id: `20261020-071403-9752`
- type: `migration`
- slug: `postgres-automation-create-route`
- status: `in_progress`

## Goal

Use the independently approved PostgreSQL automation creation repository for `POST /api/automations`, preserving static-template resolution, activation feedback, and the existing `{ automation }` success contract.

## Context

Repository slice `20261020-062203-ae91` has independent GPT-6 Luna `APPROVE`, zero findings/caveats, and forced-RLS PostgreSQL 16 evidence in disposable Docker Desktop. The route still resolves account profile through Supabase and writes automation/steps through separate Supabase calls. The repository now derives user/account scope from the verified server session and creates the parent and steps atomically. Keep the existing server-session authentication boundary; do not use Supabase as persistence or contact it during validation.

## In scope

- Wire only POST to `createPostgresAutomationCreatePersistenceRepository`, using the existing verified server session as identity input.
- Preserve static template lookup/defaulting, required-field errors, activation-validation issue details, success response `{ automation }` with status 201, and atomic persistence through the repository.
- Remove POST-path Supabase profile/admin and step insert calls.
- Add route tests for auth, invalid JSON, required fields, static template resolution, activation issues, success, safe repository errors, verified identity, and absence of Supabase data API calls.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, Docker Desktop PostgreSQL 16 integration with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and rereview until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Out of scope

GET or any other route, UI, Auth/session-provider migration, engine/cron, schema/grant/RLS changes, Supabase persistence or network use in validation, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve every existing local change. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- `npx vitest run 'src/app/api/automations/route.test.ts' src/lib/repositories/automation-create-persistence.test.ts src/lib/auth/postgres-account-guard.test.ts` — route and repository behavior.
- `npx tsc --noEmit` — TypeScript.
- `npx eslint --max-warnings=0 'src/app/api/automations/route.ts' 'src/app/api/automations/route.test.ts' src/lib/repositories/automation-create-persistence.ts src/lib/repositories/automation-create-persistence.test.ts` — targeted zero-warning lint.
- `npx prettier --check` on changed route, test, task, and handoff; format only the active `current-task.md` range.
- `pwsh -NoProfile -File scripts/testing/validate-postgres-automation-create-persistence.ps1` — AST/fixture checks and disposable PostgreSQL 16 proof; confirm cleanup and network isolation.
- `git diff --check` — whitespace/conflict markers.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this POST route slice. Record: `.harness/tasks/20261020-071403-9752/review-post-implementation-20261020.md`. Continue with a separate PostgreSQL automation-list GET route slice; keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED produced nine failures showing the old POST path queried Supabase `profiles`, used Supabase admin inserts, and did not delegate to the PostgreSQL repository. POST now retains the existing verified server session and static template resolution, preserves required-field and activation issue responses, and delegates automation plus steps to the approved PostgreSQL create repository in one transaction. The profile/admin/step Supabase persistence calls were removed from POST; GET remains unchanged. Success remains `{ automation }` with status 201, and repository errors use safe status/message mapping.

Focused route/repository/account-guard Vitest passed 58/58; `npx tsc --noEmit`, targeted zero-warning ESLint, Prettier checks, the PowerShell AST/fixture validator, and `git diff --check` passed. Fresh disposable Docker Desktop PostgreSQL 16 integration passed; evidence: `.harness/tasks/20261020-062203-ae91/validation-postgres-automation-create-0962b05b23.log`. The runner used `desktop-linux`, `--network none`, tmpfs, read-only repository mounts, generated credentials, no published ports/named volumes, synthetic fixtures, forced RLS, `NOBYPASSRLS`, minimum grants, atomic rollback and identity-cleanup probes, and reported no residual task resources. No Supabase persistence or validation network was used.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this route slice; record: `.harness/tasks/20261020-071403-9752/review-post-implementation-20261020.md`. This task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
