# Task — PostgreSQL pipeline-stage list repository

- id: `20261020-003212-d448`
- type: `migration`
- slug: `postgres-pipeline-stage-list-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository to list stages for one pipeline in the verified account.

## Context

The pipeline-list read slice received an independent Luna `APPROVE`, limited to that repository. The existing board orders stages by position. Legacy `pipeline_stages.created_at` permits SQL NULL, so preserve it in the `PipelineStage` projection. Keep consumers unwired pending H-SELF-002 and H-DB-003. Use PostgreSQL in disposable Docker Desktop only; no Supabase.

## In scope

- Require verified account membership, validate pipeline UUID, and set transaction-local RLS identity.
- Read stages by joining their parent pipeline in the verified account and its same-account creator profile.
- Map the existing `PipelineStage` projection, including nullable `created_at`, in `position ASC, id ASC` order.
- Add focused unit and forced-RLS PostgreSQL proof for projection, ordering, account/creator/parent isolation, null timestamps, empty results, invalid IDs, no session, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, stage or pipeline writes, deal/contact hydration, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Continue with the pipeline-board deal-list read slice; keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository was absent. Added server-only `src/lib/repositories/pipeline-stage-list.ts` with verified-account guard, transaction-local RLS identity, validated pipeline UUID, explicit parent pipeline/account scope, same-account creator join, `PipelineStage` mapping with nullable `created_at`, and stable `position ASC, id ASC` order.
- Focused repository/account-guard Vitest passed 15/15; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS proof passed using synthetic data and a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual resources. It covered pipeline/account/creator isolation, stable tie order, nullable timestamp, viewer access, empty result, no-session denial, fail-closed RLS, and pooled identity cleanup. Evidence: `.harness/tasks/20261020-003212-d448/validation-postgres-pipeline-stage-list-ff7e56081c.log`.
- No Supabase, consumer wiring, stage/pipeline writes, Auth/session changes, schema/grants/RLS changes, real data, traffic, or production were used.
- Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats, limited to this pipeline-stage slice. H-DATA-003 overall and consumer wiring remain unapproved.
