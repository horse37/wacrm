# Implementer handoff — PostgreSQL pipeline-stage list

## Start state

- Task `20261020-003212-d448`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty/untracked work. PostgreSQL in disposable Docker Desktop only; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only `listForPipeline(pipelineId)` repository for `public.pipeline_stages`. Require the verified-account guard, validate the pipeline UUID, set transaction-local RLS identity, explicitly scope through the parent pipeline's verified `account_id`, and require a same-account creator profile. Return the flat `PipelineStage` contract, preserving nullable legacy `created_at`, ordered by `position ASC, id ASC`.

Do not wire consumers or change stage/pipeline writes, deals, schema, Auth/session, grants/RLS, or other repositories.

## Validation

Start with a failing Vitest. Run focused repository/guard tests, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, `git diff --check`, and synthetic forced-RLS PostgreSQL 16 integration. Use task-owned disposable containers, `--network none`, tmpfs, readonly mounts, generated run-only passwords, no ports/named volumes, runtime `NOBYPASSRLS`, and assert cleanup.

## Next action

Continue with the pipeline-board deal-list read slice. Keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed module absence. Added `src/lib/repositories/pipeline-stage-list.ts` with verified-account guard, transaction-local identity, UUID validation, explicit parent pipeline/account scope, same-account creator join, nullable `PipelineStage.created_at`, and stable position/ID order.
- Focused Vitest passed 15/15; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion. Evidence: `validation-postgres-pipeline-stage-list-ff7e56081c.log`.
- No Supabase, consumer wiring, writes, Auth/session, schema/grants/RLS changes, real data, traffic, or production.
- Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this pipeline-stage slice. H-DATA-003 and consumer migration remain unapproved.
