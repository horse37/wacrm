# Task — PostgreSQL pipeline deal stage move

- id: `20261020-005148-a8ee`
- type: `migration`
- slug: `postgres-pipeline-deal-stage-move`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository operation to move a deal to a stage in its own pipeline, within the verified account.

## Context

Pipeline, stage-list, and pipeline-deal-list repositories have independent approvals limited to their slices. Existing migration 017 permits deal updates only to account members with minimum role `agent`; preserve that boundary. Use PostgreSQL in disposable Docker Desktop only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership and minimum `agent` role; validate both UUIDs.
- Set transaction-local RLS identity and update only `stage_id` for the verified-account deal.
- Require same-account deal/pipeline creators and target stage belonging to the deal's pipeline.
- Return a safe not-found result for missing, foreign-account, or cross-pipeline rows.
- Test authorization, isolation, parameterization, and pooled identity cleanup using synthetic forced-RLS PostgreSQL.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, other deal fields/status/create/delete, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Independent same-model GPT-6 Luna review returned `APPROVE`, zero findings and caveats, for this slice only. Continue with the next narrow pipeline-deal mutation; keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository module was absent. Added server-only `moveToStage(dealId, stageId)`, requiring a verified session and minimum `agent` role as in migration 017; SQL binds the verified account, deal ID, and target stage ID, sets transaction-local RLS identity, and checks same-account creators plus target-stage parent pipeline.
- Unit tests and PostgreSQL account-guard tests passed 14/14. TypeScript (`npx tsc --noEmit`) and targeted ESLint (`--max-warnings=0`) passed. Prettier check passed for supported source/Markdown files; PowerShell AST, SQL fixture whitespace, and `git diff --check` passed.
- Final disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic fixtures, runtime `NOBYPASSRLS`, stage-column-only UPDATE grant, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual resources. It verified owner/agent success, viewer denial, cross-account/deal/pipeline-creator/stage-parent isolation, `updated_at` trigger, not-found concealment, and pooled identity cleanup. Evidence: `.harness/tasks/20261020-005148-a8ee/validation-postgres-pipeline-deal-stage-move-ced1614001.log`.
- Two early disposable proof attempts failed in the test harness (double-unwrapping a transaction result; then an incorrect synthetic `updated_at` expectation); both were corrected before the final successful run. Their logs remain preserved.
- No Supabase, consumer wiring, other deal mutations, Auth/session changes, schema/grant/RLS changes, real data/credentials, traffic, or production. Approval is limited to this slice; task stays `in_progress`.

### Independent review — 2026-10-20

- Verdict: `APPROVE`, zero findings and caveats for this slice only.
- The read-only same-model GPT-6 Luna reviewer confirmed `agent` authorization matches migration 017, the update changes only `stage_id`, and account/deal/pipeline-creator/target-stage constraints are parameterized and fail closed. It verified final forced-RLS Docker evidence, cleanup, and focused validation results.
- Task remains `in_progress`; this approval does not cover H-DATA-003/H-DB-003 overall, H-SELF-002, Auth, Storage, Realtime, application traffic, or production.
