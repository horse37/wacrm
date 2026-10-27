# Implementer handoff — PostgreSQL flow creation persistence

## Start state

- Task `20261020-052532-c1b8`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked files. Use synthetic PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement an unwired server-only PostgreSQL repository for creating a draft flow and optionally cloning its node graph in one transaction. Require a verified `agent`-or-higher account membership, validate all input before mutation, derive creator/account IDs from the session guard, set transaction-local RLS identity, and prove rollback if a child insert fails. Return created flow identity. Keep API/UI, Auth/session provider, and status activation logic unchanged.

## Validation

Begin with failing focused Vitest. Then run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, exact minimum grants, account/role isolation, successful plain/template creation, atomic rollback, generated credentials, synthetic fixtures, `--network none`, tmpfs, read-only mounts, and cleanup checks. Obtain fresh independent GPT-6 Luna read-only review and remediate until exact `APPROVE`, zero findings, and zero caveats.

## Restrictions

No Supabase, route wiring, Auth/session provider work, activation/status updates, provider calls, permanent schema/grant/RLS changes, real credentials/data, application traffic, production, commit, push, or deploy. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- TDD RED confirmed repository absence. Added an unwired server-only PostgreSQL draft-flow creation repository with verified account role, actor/account-derived creator fields, validation before mutation, and atomic parent plus optional node inserts. Empty nodes create a plain draft; schema supplies the fallback policy when omitted.
- This repository's Vitest passed 7/7; combined create/graph/header/delete/editor suites passed 47/47. TypeScript, zero-warning targeted ESLint, Prettier check, PowerShell AST/fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed `NOBYPASSRLS`, exact minimum grants, account/role isolation, plain/template draft creation, synthetic insert-trigger rollback, identity cleanup, and resource cleanup. Final log: `validation-postgres-flow-create-bbdff29cdb.log`.
- Independent GPT-6 Luna read-only review returned exact `APPROVE` with no findings or caveats, limited to this repository slice. Next: isolate flow status transition/activation validation in PostgreSQL; keep the route unwired and H-DATA-003/H-DB-003 unapproved overall.
