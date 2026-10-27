# Task — PostgreSQL pipeline deal creation

- id: `20261020-010456-5b18`
- type: `migration`
- slug: `postgres-pipeline-deal-create`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository operation to create one deal in the verified account.

## Context

Pipeline, stage-list, pipeline-deal-list, stage-move, and status-update repository slices have independent approvals limited to their own scope. Existing migration 017 requires minimum account role `agent` for deal inserts. The deal form creates status `open` and submits title, value, currency, contact, pipeline, stage, assignee, notes, and expected close date. Use task-owned disposable PostgreSQL in Docker Desktop only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require a verified session and minimum `agent` role; derive `user_id` and `account_id` from verified context, never request fields.
- Validate title, numeric value, currency, UUID relations, optional notes/assignee/date; insert status `open` only.
- Scope pipeline, stage, contact, optional assignee, and pipeline creator to the verified account; require the stage to belong to the selected pipeline.
- Use parametrized SQL, transaction-local RLS identity, safe not-found for inaccessible related rows, and validate returned ID.
- Cover authorization, input validation, tenant/relationship isolation, parameterization, RLS, and pooled identity cleanup.

## Out of scope

- UI/API wiring, Auth/session replacement, deal update/status/stage/delete, schema/migration/grant/RLS changes, other repositories, Supabase, Storage, Realtime, real credentials/data, existing Docker resources, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, and `git diff --check`.
- Disposable PostgreSQL 16 in Docker Desktop with synthetic forced-RLS fixture, runtime `NOBYPASSRLS`, insert-column-only grant, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.
- Fresh independent same-model GPT-6 Luna read-only review; remediate and repeat until APPROVE with zero findings and caveats.

## Next action

Continue with the next narrow pipeline-deal PostgreSQL repository slice, keeping this approval limited to deal creation. Leave this task `in_progress` and consumers unwired.

## Implementation evidence

- TDD RED confirmed the repository module was absent. Added `src/lib/repositories/pipeline-deal-create.ts`; focused repository plus account-guard Vitest passed 16/16.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier for supported files, PowerShell AST/fixture least-privilege checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, column-level INSERT grants only, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual resources. It covered owner/agent identity derivation, `open` status, field normalization, nullable fields, viewer denial, pipeline/stage/contact/assignee/creator isolation, invalid inputs, and pooled identity cleanup. Evidence: `validation-postgres-pipeline-deal-create-7c6a548346.log`.
- No Supabase, consumers, other deal mutations, schema/grants/RLS changes, real data/credentials, traffic, or production were used.
- Independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats, limited to this deal-create slice. Task remains `in_progress`; H-DATA-003 and H-DB-003 remain unapproved overall.
