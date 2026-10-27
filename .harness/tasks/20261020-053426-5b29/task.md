# Task — PostgreSQL flow status transition and activation validation

- id: `20261020-053426-5b29`
- type: `migration`
- slug: `postgres-flow-status-transition`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository for account-scoped flow status changes, validating the current node graph before activation and updating status transactionally.

## Context

`POST /api/flows/[id]/activate` currently reads flow/nodes through the Supabase admin client, validates active transitions, then updates status in a separate operation. PostgreSQL list/editor/create/update/delete repository slices have limited independent approvals. PostgreSQL in disposable Docker Desktop is the target; do not use Supabase.

## In scope

- Require a verified `agent`-or-higher account membership and validate requested flow UUID/status before database mutation.
- Set transaction-local RLS identity; acquire the shared account/flow transaction advisory lock before reading the flow or graph, then lock/load the flow only inside the verified account with creator/profile consistency.
- For `active`, load current node fields under the same transaction and run existing pure `validateFlowForActivation`; return validation issues without writing when error blockers exist. Warnings do not block. Draft/archive transitions stay unconditional, matching current handler behavior.
- Update only `status` and `updated_at` in the same transaction; return flow identity/status/issues. Use parameterized SQL.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimum privileges, account/role isolation, valid activation, blocked activation, unconditional draft/archive, and transaction identity cleanup with synthetic data in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, provider calls, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest; then focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned PostgreSQL 16 integration in disposable Docker Desktop with forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, valid/invalid transition probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Continue with the next narrow H-DATA-003 PostgreSQL repository slice. Keep route/UI unwired and this HARNESS task `in_progress`; the approval below is limited to this status slice and its shared-lock remediation.

## Implementation and validation

TDD RED confirmed the repository was absent. Added an unwired server-only PostgreSQL status-transition repository requiring verified `agent`-or-higher membership, validating UUID/status, setting transaction-local RLS identity, and acquiring the shared transaction advisory lock derived from account/flow IDs before the account- and creator-scoped flow row lock. Activation loads current nodes in the same transaction and calls the existing pure validator; error issues block writes while warnings allow activation. Draft/archive remain unconditional, and the update changes only `status` and `updated_at`.

An independent reviewer found a P2 race between activation and graph replacement. Both repositories now acquire the same account/flow advisory transaction lock before parent/node reads or graph mutation. This uses built-in PostgreSQL advisory-lock functions and keeps the graph repository's minimum `flows` privileges unchanged; the status repository retains its row lock for its status update. A deterministic PostgreSQL barrier test proves activation waits for a concurrent replacement, sees its invalid graph, and leaves status draft.

Focused flow transition/validator/create/graph/header/delete/editor tests passed 86/86. TypeScript and targeted ESLint with zero warnings passed. Prettier passed for new implementation/tests/integration and task documentation. The legacy validator source fails Prettier check on the original HEAD as confirmed from `git show HEAD`; this slice changes only its import path from the tsconfig alias to an equivalent relative import so the raw Node ESM integration loader can resolve it. PowerShell AST/fixture checks and `git diff --check` passed.

Disposable Docker Desktop PostgreSQL 16 status integration passed with forced RLS, runtime `NOBYPASSRLS`, exact combined minimum column/table grants (only the graph operation's required `flow_nodes` DELETE table grant), role/account isolation, valid activation, blocked invalid graph, warning-only activation, unconditional draft/archive, serialized graph replacement/activation, transaction GUC cleanup, and resource cleanup. Synthetic data/generated credentials, `desktop-linux`, `--network none`, tmpfs, and read-only repository mounts. Final evidence: `.harness/tasks/20261020-053426-5b29/validation-postgres-flow-status-704320c842.log`. The updated graph repository's standalone Docker integration also passed after the shared-lock change: `.harness/tasks/20261020-051507-1c3e/validation-postgres-flow-node-graph-replace-88924a582a.log`. Earlier row-lock graph runner attempt failed because that repository's role correctly lacked UPDATE on `flows`; replaced by the privilege-preserving advisory lock approach; failure log is retained. No route/UI wiring, Supabase, production, commit, push, or deploy; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review — 2026-10-20

Fresh independent GPT-6 Luna read-only re-review returned exact `APPROVE`, zero findings, and zero caveats, limited to the flow status transition slice and shared account/flow advisory-lock remediation with graph replacement. The reviewer confirmed `main`, expected HEAD, shared transaction lock ordering, Docker concurrency evidence, least-privilege/RLS fixture, and consistent scope records. This is not approval of either HARNESS task as a whole, H-DATA-003/H-DB-003, route wiring, Supabase/Auth, Storage, Realtime, application traffic, or production. Review record: `review-post-lock-20261020.md`.
