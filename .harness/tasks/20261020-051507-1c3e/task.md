# Task — PostgreSQL flow-node graph replacement

- id: `20261020-051507-1c3e`
- type: `migration`
- slug: `postgres-flow-node-graph-replacement`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository to replace a flow's node graph for an agent's verified account, atomically.

## Context

`PUT /api/flows/[id]` currently deletes then reinserts `flow_nodes` through Supabase outside a transaction. Separate PostgreSQL flow-delete and flow-header-update repository slices received independent GPT-6 Luna `APPROVE`, each limited to its own slice. PostgreSQL in disposable Docker Desktop is the target; do not use Supabase.

## In scope

- Require a verified account session and `agent`-or-higher account role.
- Validate the node array, node keys/types/configs/positions, and reject duplicate node keys before database mutation.
- Set transaction-local RLS identity, verify the requested parent flow/account and creator-profile consistency, delete its existing nodes, and insert replacements in one PostgreSQL transaction. Empty arrays intentionally clear the graph.
- Use only parameterized SQL and minimum `flow_nodes` SELECT/DELETE/INSERT privileges; preserve safe not-found behavior and prove rollback after a database-side insert failure.
- Prove forced RLS, runtime `NOBYPASSRLS`, role/account isolation, atomic replacement/rollback, and identity cleanup with synthetic data in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, flow header/status changes, provider calls, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest; then run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned PostgreSQL 16 integration in disposable Docker Desktop with forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, atomic replacement/rollback probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Continue with a separate PostgreSQL repository slice for flow status transitions, keeping activation validation and status writes transactional. Keep API/UI consumers unwired.

## Implementation and validation

- TDD RED confirmed `flow-node-graph-replace.ts` was absent. Focused Vitest passed 13/13; the combined graph-replacement, header-update, flow-delete, and flow-editor-load suites passed 40/40.
- Added an unwired server-only repository requiring `agent`-or-higher verified membership. It validates supported node types, unique non-empty keys, JSON object configs, and PostgreSQL integer-range positions before mutation; it scopes the parent and child delete to the verified account and creator profile, then deletes/inserts in one transaction. Empty arrays clear the graph. No flow header/status rows are changed.
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier check, PowerShell AST parse, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed forced RLS on accounts/profiles/flows/flow_nodes, runtime `NOBYPASSRLS`, exact minimum column/table grants, role/account isolation, `http_fetch` and `send_media` nodes, empty graph, rollback after a synthetic database-side insert rejection, successful replacement, persisted defaults, and transaction identity cleanup. Synthetic-only data, generated credentials, `--network none`, tmpfs, read-only mounts, and no residual task resources. Final evidence: `validation-postgres-flow-node-graph-replace-c93d62ad67.log`.
- No route wiring, Supabase, Auth/session migration, header/status changes, provider calls, real credentials/data, app traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Review remediation — 2026-10-20

- First independent GPT-6 Luna review returned `REMEDIATION_REQUIRED` with one P2: the disposable fixture omitted `send_media`, a type permitted by migration 016 and the repository.
- Added `send_media` to the fixture's node-type check and added positive `send_media` coverage to the Vitest and Docker PostgreSQL integration/bootstrap probe.
- After correction, the combined focused suites passed 40/40; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST, and `git diff --check` passed. Docker Desktop PostgreSQL 16 rerun passed with no residual resources; see final evidence log above.
- Fresh independent GPT-6 Luna read-only re-review returned exact `APPROVE`, zero findings, and zero caveats. It confirmed the `send_media` fixture correction and positive Vitest/PostgreSQL coverage, account/role scoping, RLS identity, parameterized SQL, transaction behavior, and the final integration log. Approval is limited to this repository slice; H-DATA-003/H-DB-003, route wiring, Auth/session migration, Supabase, Storage, Realtime, traffic, and production remain unapproved/out of scope.

## Follow-up concurrency remediation — 2026-10-20

- A later independent review of flow activation found a race unless graph replacement and activation serialize. The graph repository now acquires the same PostgreSQL transaction advisory lock as the status repository, derived from verified account ID and flow ID, before parent/node reads or graph mutation. This avoids requiring `UPDATE` privileges on `flows` for graph replacement; the graph repository's existing minimum grants stay unchanged.
- Focused flow repository/validator suites passed 86/86; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed after the lock change.
- The updated standalone graph PostgreSQL 16 integration passed forced RLS, `NOBYPASSRLS`, account/role isolation, atomic rollback/replacement, empty graph, supported nodes, and identity/resource cleanup. Evidence: `validation-postgres-flow-node-graph-replace-88924a582a.log`. A separate deterministic concurrency probe in the status task confirms activation waits for replacement and then rejects the replacement's invalid graph: `.harness/tasks/20261020-053426-5b29/validation-postgres-flow-status-704320c842.log`.
- The earlier slice approval predates this shared-lock code change. Fresh independent GPT-6 Luna read-only re-review returned exact `APPROVE`, zero findings, and zero caveats for the flow-status slice and shared account/flow lock remediation with this graph repository. Evidence and full scope boundary: `.harness/tasks/20261020-053426-5b29/review-post-lock-20261020.md`. This does not approve the graph HARNESS task as a whole or H-DATA-003/H-DB-003; both tasks remain `in_progress`, and excluded surfaces remain unapproved.
