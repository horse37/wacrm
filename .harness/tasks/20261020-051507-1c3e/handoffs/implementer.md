# Implementer handoff — PostgreSQL flow-node graph replacement

## Start state

- Task `20261020-051507-1c3e`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked files. Use synthetic PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only repository to atomically replace only the nodes for an existing flow in the verified account. Require `agent`-or-higher role; validate node content and unique keys before mutation; use parameterized statements and transaction-local RLS identity. Keep flow header, status, route/UI, and Auth/session provider unchanged.

## Validation

Begin with failing focused Vitest. Run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and task-owned disposable Docker Desktop PostgreSQL 16 proof with forced RLS, `NOBYPASSRLS`, exact minimum grants, account/role isolation, atomic replacement and rollback, generated credentials, synthetic data, `--network none`, tmpfs, read-only mounts, and cleanup checks. Obtain fresh independent GPT-6 Luna read-only review and remediate until exact `APPROVE`, zero findings/caveats.

## Restrictions

No Supabase use, route wiring, Auth/session provider work, header/status changes, provider calls, permanent schema/grant/RLS changes, real credentials/data, application traffic, production, commit, push, or deploy. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- TDD RED confirmed the repository module was absent. Focused Vitest passed 13/13; combined graph/header/delete/editor suites passed 40/40.
- Added only the unwired graph replacement repository with verified agent role, strict node validation/unique keys, account and creator scoping, parameterized SQL, transaction-local identity, and atomic delete/insert. Empty node arrays intentionally clear the graph.
- TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed forced RLS, `NOBYPASSRLS`, exact minimum grants, account/role isolation, positive `http_fetch` and `send_media` coverage, synthetic-trigger rollback verification, replacement/default positions, empty-graph behavior, identity cleanup, and resource cleanup. Final evidence: `validation-postgres-flow-node-graph-replace-c93d62ad67.log`.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this unwired repository slice. The `send_media` fixture correction and unit/PostgreSQL coverage were confirmed. Continue with an isolated PostgreSQL repository for flow status transitions, preserving activation validation and update atomicity. Keep API/UI consumers unwired; H-DATA-003/H-DB-003 remain unapproved overall.

## Review remediation

- First independent review found the fixture's `node_type` check omitted migration-supported `send_media` (P2). Added the type to the fixture and positive Vitest/Docker integration assertions.
- Post-fix combined focused tests passed 40/40; TypeScript, zero-warning ESLint, Prettier, PowerShell AST, diff check, and Docker forced-RLS PostgreSQL rerun passed.

## Follow-up concurrency remediation — 2026-10-20

A later independent flow-status review identified a race between activation and graph replacement. The graph repository now acquires the same account/flow-keyed PostgreSQL transaction advisory lock as the status repository before parent/node reads and graph mutation. This preserves the graph repository's minimum grants and avoids granting UPDATE on `flows` merely to lock its row. Focused suites passed 86/86; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. The updated graph Docker integration passed at `validation-postgres-flow-node-graph-replace-88924a582a.log`; the deterministic concurrent status/graph proof passed at `.harness/tasks/20261020-053426-5b29/validation-postgres-flow-status-704320c842.log`. Fresh independent GPT-6 Luna read-only re-review returned exact `APPROVE`, zero findings, and zero caveats for the status slice and shared-lock change with graph replacement; record: `.harness/tasks/20261020-053426-5b29/review-post-lock-20261020.md`. Keep both tasks and H-DATA-003/H-DB-003 in progress/unapproved overall.
