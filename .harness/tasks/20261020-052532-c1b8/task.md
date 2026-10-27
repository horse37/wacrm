# Task — PostgreSQL flow creation persistence

- id: `20261020-052532-c1b8`
- type: `migration`
- slug: `postgres-flow-create-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository that creates a draft flow and, for a template clone, inserts its nodes atomically within the verified agent account.

## Context

`POST /api/flows` currently writes flows and cloned template nodes through the Supabase admin client in separate operations. Flow list/editor reads, run-history reads, flow delete, header update, and graph replacement have slice-limited PostgreSQL implementations/reviews. The target is PostgreSQL in disposable Docker Desktop; do not use Supabase.

## In scope

- Require verified `agent`-or-higher account membership and derive creator/account IDs only from that context.
- Validate flow metadata and optional template nodes before database mutation; keep status fixed to `draft`.
- Set transaction-local RLS identity; insert the flow and all supplied nodes in one PostgreSQL transaction. Return the created flow identity; roll back the parent if any node insert fails.
- Use parameterized SQL, creator/account consistency, and minimum INSERT/SELECT privileges only in the disposable fixture.
- Prove forced RLS, runtime `NOBYPASSRLS`, role/account isolation, plain draft creation, template graph persistence, rollback, and identity cleanup with synthetic data in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, flow activation/status transitions, provider calls, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest; then focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned PostgreSQL 16 integration in disposable Docker Desktop with forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, atomic creation/rollback probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Continue with a separate PostgreSQL repository slice for flow status transitions and activation validation; keep route/UI unwired.

## Implementation and validation

- TDD RED confirmed `flow-create-persistence.ts` was absent. Added an unwired server-only repository that derives creator/account identity from verified `agent`-or-higher membership, validates flow metadata and optional nodes before opening the write transaction, forces `draft` status, inserts the flow, then inserts template nodes in that same transaction. Empty nodes create a plain draft; omitted fallback policy uses the schema default. Unknown input fields (including caller-supplied account IDs), duplicate node keys, malformed JSON objects, unsupported node types, invalid positions, and explicit null node arrays are rejected before mutation.
- Focused Vitest passed 7/7 for this repository; combined create/graph-replacement/header-update/delete/editor-load suites passed 47/47. TypeScript, targeted ESLint `--max-warnings=0`, Prettier check, PowerShell AST/fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed forced RLS, runtime `NOBYPASSRLS`, exact minimum column grants/no table grants, unauthorized/viewer/account isolation, plain draft and template graph creation, default/explicit metadata, synthetic trigger rollback, and transaction identity cleanup. Synthetic data, generated credentials, Docker context `desktop-linux`, `--network none`, tmpfs database, read-only repository mounts, no ports/named volumes, and no residual resources. Final evidence: `validation-postgres-flow-create-bbdff29cdb.log`.
- Two earlier harness attempts are retained in their uniquely named logs; they exposed a stale bootstrap role name and an incorrect post-probe count. Both were fixed before the successful final run.
- No route wiring, Supabase, Auth/session migration, provider calls, real credentials/data, app traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
- Independent GPT-6 Luna read-only review returned exact `APPROVE` with no findings or caveats, limited to this repository slice. The reviewer was instructed to inspect the forced-RLS Docker evidence and did not require additional validation.
