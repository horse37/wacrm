# Task — PostgreSQL automation list

- id: `20261020-012732-0a44`
- type: `migration`
- slug: `postgres-automation-list`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository to list automations visible in the verified account.

## Context

H-DATA-003 prioritizes automations/flows after account, WhatsApp, conversation/message, contact/tag, and custom-field repositories. The existing automation page reads `automations` with Supabase and uses name, description, trigger type, active state, execution count, and last execution time. Use PostgreSQL in disposable Docker Desktop only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership; read access includes viewer role per migration 017.
- Set transaction-local RLS identity and explicitly scope the query to the verified account.
- Require the automation creator profile to match its account; order by newest creation with stable ID tie-break.
- Return only list-card fields; omit `trigger_config`, `user_id`, and other fields unnecessary for the current list UI.
- Test role/account isolation, malformed creator relationships, stable ordering, parameterization, nullable values, and pooled identity cleanup.

## Out of scope

No UI/API wiring, automation create/update/delete, steps/logs/pending executions, engine/service-role migration, Auth/session replacement, schema/grant/RLS changes, Supabase, Storage, Realtime, real credentials/data, existing Docker resources, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Disposable PostgreSQL 16 Docker Desktop forced-RLS integration with synthetic fixtures, runtime `NOBYPASSRLS`, minimal SELECT grants, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.
- Fresh independent same-model GPT-6 Luna read-only review; remediate and repeat until APPROVE with zero findings and caveats.

## Worktree result — 2026-10-20

Implemented `src/lib/repositories/automation-list.ts` and focused unit/integration evidence. The server-only repository requires verified account membership (including viewer), sets `request.jwt.claim.sub` transaction-locally, filters by verified account, requires a creator profile in that account, and orders by `created_at DESC, id DESC`. Projection returns only `id`, `name`, `description`, `trigger_type`, `is_active`, `execution_count`, and UTC `last_executed_at`; it omits `trigger_config`, `user_id`, `account_id`, and timestamps not used by the list card.

Focused Vitest: 13/13; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed. PowerShell AST and fixture grant checks passed. Disposable PostgreSQL 16 Docker Desktop forced-RLS proof passed with runtime `NOBYPASSRLS`, only SELECT grants on accounts/profiles/automations, `--network none`, tmpfs database, read-only mounts, generated synthetic passwords, no ports or named volumes. It covered owner/agent/viewer reads, account/creator isolation, stable tie ordering, nullable fields, minimal DTO, empty account, and pool identity cleanup. Evidence: `validation-postgres-automation-list-126e60003a.log`; cleanup found no residual task resources.

No consumer is wired; no Supabase, schema/grant/RLS change, real data, traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved.

## Next action

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats, limited to this automation-list slice. Reviewer confirmed branch `main` and HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`; no files changed during review.

Continue with the next narrow PostgreSQL repository slice in H-DATA-003. Keep this task `in_progress` and consumers unwired.
