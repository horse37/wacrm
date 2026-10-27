# Implementer handoff — PostgreSQL pipeline deal list

## Start state

- Task `20261020-003901-2a69`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty/untracked work. PostgreSQL in disposable Docker Desktop only; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement server-only `listForPipeline(pipelineId)` for board deals. Require the verified-account guard, validate pipeline UUID, set transaction-local RLS identity, and bind both the verified account and requested pipeline. Verify same-account deal and pipeline creators, require a stage belonging to the same pipeline, and include only same-account optional contact and assignee summaries. Preserve nullable contact/date timestamps and use timezone-safe DATE serialization for `expected_close_date`. Keep `NUMERIC(12,2)` parsing bounded and deterministic.

Do not wire consumers or change deal/pipeline/stage writes, schema, Auth/session, grants/RLS, or other repositories.

## Validation

Start with failing Vitest. Run focused repository/guard tests, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, `git diff --check`, and synthetic forced-RLS PostgreSQL 16 integration. Use task-owned disposable containers, `--network none`, tmpfs, readonly mounts, generated run-only passwords, no ports/named volumes, runtime `NOBYPASSRLS`, and assert cleanup.

## Implementation result

## Result

Implemented the server-only pipeline deal-list read. TDD RED confirmed the repository module was absent. First independent read-only Luna review found one P2: nullable `updated_at` was omitted. The mapper and narrow type now preserve it as `string | null`, and unit plus PostgreSQL integration expectations cover null. After remediation, focused Vitest passed 21/21 across the pipeline deal list, contact deal list, and PostgreSQL account guard. TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed. Final disposable Docker Desktop PostgreSQL 16 forced-RLS proof passed; evidence: `../validation-postgres-pipeline-deal-list-dad458f0f4.log`.

No Supabase, consumer wiring, Auth/session changes, schema/grant/RLS changes, real data/credentials, traffic, or production. Keep the task `in_progress` and consumers unwired.

## Next action

Independent same-model GPT-6 Luna re-review returned `APPROVE`, zero findings and caveats, limited to this slice. Reviewer confirmed nullable `updated_at` is preserved in the type, mapper, unit/integration expectations, and final Docker evidence. Task remains `in_progress`; consumers remain unwired. Continue to the next narrow PostgreSQL repository slice without using Supabase.
