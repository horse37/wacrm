# Task — PostgreSQL automation deletion persistence

- id: `20261020-055453-2a1c`
- type: `migration`
- slug: `postgres-automation-delete-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository for deleting only the verified user's automation within the verified account.

## Context

`DELETE /api/automations/[id]` currently uses the Supabase admin client, filtering by automation ID and authenticated user ID. PostgreSQL automation list/log/editor and approved-template read repositories are separate limited slices. PostgreSQL in disposable Docker Desktop is the target; do not use Supabase.

## In scope

- Require the existing server-verified account guard and validate automation UUID before database mutation.
- Set transaction-local RLS identity; delete only the automation matching requested ID, verified account, verified user, and consistent creator profile, using parameterized SQL and `RETURNING`.
- Preserve safe `not_found` behavior and existing cascade semantics for automation steps, logs, and pending executions.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimum grants, user/account isolation, cascades, and identity/resource cleanup in synthetic Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, provider calls, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest, then run focused suites, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned Docker Desktop PostgreSQL 16 with forced RLS, `NOBYPASSRLS`, exact minimum privileges, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, cascade/isolation probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

The delete repository received slice-limited independent GPT-6 Luna `APPROVE`, zero findings/caveats. Continue with a separate automation-duplicate persistence task; keep route unwired and this task `in_progress`.

## Implementation and validation

- Added an unwired server-only PostgreSQL delete repository. It requires verified `agent`-or-higher membership, validates the UUID, sets transaction-local RLS identity, and deletes only by requested ID, verified user/account, and matching creator profile. Missing, non-owned, cross-account, and inconsistent-profile rows return safe `not_found`; FK cascades remain database-owned.
- TDD RED confirmed the repository module was absent; focused repository and account-guard tests passed 15/15. TypeScript, targeted ESLint with `--max-warnings=0`, Prettier, and `git diff --check` passed.
- The initial independent review found a P2: a four-connection pool made the pooled identity cleanup probe nondeterministic. Remediation is recorded in `review-initial-20261020.md`; concurrent deletion remains in a pool-four process, and same-connection cleanup is now a separate pool-one process asserting identical `pg_backend_pid()` before/after committed deletion and `auth.uid() IS NULL`.
- Final disposable PostgreSQL 16 Docker Desktop integration passed with forced RLS on account/profile/automation/child tables, `NOBYPASSRLS`, exact parent DELETE plus narrow SELECT grants, and no direct child-table privileges. Synthetic two-account fixtures verified agent enforcement, owner/account/profile isolation, concurrent deletion, all three cascades, deterministic pooled identity cleanup, and no-identity RLS behavior. Evidence: `.harness/tasks/20261020-055453-2a1c/validation-postgres-automation-delete-04b524d979.log`.
- The runner used `desktop-linux`, `--network none`, tmpfs, read-only workspace mounts, generated credentials, no published ports or named volumes, and confirmed cleanup. No Supabase, real data/credentials, route/UI wiring, app traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent read-only review

- First review returned `REMEDIATION_REQUIRED` for a nondeterministic pool identity cleanup probe. The P2 and its correction are documented in `review-initial-20261020.md`.
- Fresh GPT-6 Luna re-review returned exact `APPROVE`, zero findings, and zero caveats for this repository slice only. Record: `review-post-remediation-20261020.md`.
- The task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
