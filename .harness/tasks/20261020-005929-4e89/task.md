# Task — PostgreSQL pipeline deal status update

- id: `20261020-005929-4e89`
- type: `migration`
- slug: `postgres-pipeline-deal-status-update`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository operation to update a deal's `open`, `won`, or `lost` status in the verified account.

## Context

Pipeline list, stage list, pipeline-deal list, and deal-stage-move repositories have independent approvals limited to their slices. Existing migration 017 permits deal updates only to account members with minimum role `agent`; the existing schema constrains status to `open`, `won`, or `lost`. Use PostgreSQL in disposable Docker Desktop only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership and minimum `agent` role; validate deal UUID and runtime status.
- Set transaction-local RLS identity and update only the requested status under explicit account scope.
- Require same-account deal and pipeline creators; return safe not-found for missing/foreign rows.
- Test authorization, valid transitions, invalid input, account isolation, parameterization, and pooled identity cleanup with synthetic forced-RLS PostgreSQL.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, other deal fields/stage/create/delete, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

### Implementation evidence

- TDD RED confirmed the repository module was absent. Implemented `src/lib/repositories/pipeline-deal-status-update.ts`; the unit suite passed 6/6, and the account-guard plus repository focus passed 14/14.
- TypeScript, targeted ESLint with zero warnings, Prettier check, PowerShell AST/fixture whitespace, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with status-column-only UPDATE grant, owner/agent transitions, viewer denial, account/deal/pipeline-creator isolation, trigger behavior, invalid input, transaction-local identity cleanup, and no residual resources. Evidence: `validation-postgres-pipeline-deal-status-update-fd035e040b.log`.
- PostgreSQL fixture and runner used synthetic data, `NOBYPASSRLS`, `--network none`, tmpfs, read-only repository mounts, no published ports/named volumes, and generated run-only passwords. No Supabase.
- Independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats, limited to this diff. Task remains `in_progress`; no overall H-DATA-003/H-DB-003 approval.

## Next action

Continue with the next narrow PostgreSQL repository slice, preserving this approval as slice-scoped. Keep task `in_progress` and consumers unwired.
