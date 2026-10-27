# Implementer handoff — PostgreSQL flow status transition

## Start state

- Task `20261020-053426-5b29`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked files. Use synthetic PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement an unwired server-only PostgreSQL repository for changing a flow to `draft`, `active`, or `archived`. Require a verified `agent`-or-higher role, scope to the verified account and consistent creator profile, set transaction-local RLS identity, and acquire the shared account/flow transaction advisory lock before flow/node reads or mutations. When activating, load its current nodes and call the existing pure activation validator inside the same transaction; reject error blockers without a write, allow warnings, and make draft/archive unconditional. Update only status and `updated_at`.

## Validation

Begin with failing focused Vitest. Then run focused tests, typecheck, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, exact minimum privileges, valid/blocked activation, unconditional draft/archive, account/role isolation, generated credentials, synthetic data, `--network none`, tmpfs, read-only mounts, and cleanup verification. Obtain independent GPT-6 Luna read-only review and remediate until exact `APPROVE`, zero findings, zero caveats.

## Restrictions

No Supabase, route wiring, Auth/session provider work, provider calls, permanent schema/grant/RLS changes, real credentials/data, application traffic, production, commit, push, or deploy. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation update

Implemented the unwired server-only PostgreSQL status-transition repository. It requires verified `agent`-or-higher membership, validates flow UUID/status, sets transaction-local RLS identity, acquires a shared advisory lock derived from account/flow IDs, locks the scoped flow row, and validates current nodes in the same transaction before activation. Error issues block the update; warnings allow it. Draft/archive remain unconditional. The update changes only status and timestamp.

The first independent Luna review found a P2 race because graph replacement did not coordinate with activation. Both repositories now acquire the same account/flow advisory transaction lock before parent/node reads and graph mutation; status also takes its existing row lock. This avoids extra `flows` UPDATE privilege for graph edits. A deterministic PostgreSQL barrier test proves activation waits for graph replacement, validates the new graph, and leaves it draft when invalid.

Focused status/validator/create/graph/header/delete/editor Vitest suites passed 86/86. TypeScript, targeted zero-warning ESLint, Prettier for new files/task docs, PowerShell AST/fixture checks, and `git diff --check` passed. The existing validator source itself fails Prettier check on original HEAD; its only diff is an equivalent relative import required by the raw Node ESM integration loader. The final disposable Docker Desktop PostgreSQL 16 status integration passed forced RLS, runtime `NOBYPASSRLS`, combined minimum grants, account/role isolation, valid/blocked/warning activation, unconditional draft/archive, serialized graph replacement/activation, transaction identity cleanup, and resource cleanup. Synthetic data, generated credentials, `desktop-linux`, `--network none`, tmpfs, and read-only mounts. Evidence: `.harness/tasks/20261020-053426-5b29/validation-postgres-flow-status-704320c842.log`. The updated graph repository's standalone Docker integration also passed: `.harness/tasks/20261020-051507-1c3e/validation-postgres-flow-node-graph-replace-88924a582a.log`. An earlier graph runner try with row locking is preserved as failed; it required an unavailable flows UPDATE privilege and was replaced by the advisory lock.

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this status slice and its shared-lock remediation with graph replacement. Full response and scope boundary are recorded in `review-post-lock-20261020.md`. This does not approve either HARNESS task overall or H-DATA-003/H-DB-003. Keep route/UI unwired; PostgreSQL Docker only.

## Next action

Continue with the next narrow PostgreSQL repository slice in H-DATA-003. Preserve this task as `in_progress`; the approval above is slice-limited. Keep routes/UI unwired and H-DATA-003/H-DB-003 unapproved overall.
