# Task — PostgreSQL pipeline deal delete

- id: `20261020-011649-129a`
- type: `migration`
- slug: `postgres-pipeline-deal-delete`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository operation for the existing pipeline deal delete action.

## Context

The deal editor currently deletes `public.deals` directly, and migration 017 permits account members with role `agent` or higher to delete deals. The product's no-delete rule applies to message records; it does not prohibit deleting deals. Prior deal list, stage move, status update, creation, and details-update repositories have limited independent reviews. Use disposable Docker Desktop PostgreSQL only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership and minimum `agent` role; validate the deal UUID.
- Set the transaction-local RLS identity and issue a parameterized delete scoped to the verified account and deal ID.
- Require the deal creator and pipeline creator profiles to match the deal/pipeline account; return safe `not_found` for inaccessible or inconsistent rows.
- Return success only for exactly one deleted row and test role denial, tenant isolation, creator consistency, not-found, SQL binding, and pooled identity cleanup.
- Prove only the target deal row is removed; parent pipeline/stage/contact and other-account/other deals remain.

## Out of scope

No UI/API wiring, Auth/session replacement, schema/migration/grant/RLS changes, other repositories, Supabase, message deletion/editing, Storage, Realtime, real credentials/data, existing Docker resources, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Disposable PostgreSQL 16 Docker Desktop forced-RLS integration with synthetic fixtures, runtime `NOBYPASSRLS`, least necessary SELECT/DELETE grants, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.
- Fresh independent same-model GPT-6 Luna read-only review; remediate and repeat until APPROVE with zero findings and caveats.

## Next action

## Review remediation — 2026-10-20

Initial implementation passed focused validation and disposable Docker PostgreSQL integration (`validation-postgres-pipeline-deal-delete-99b5c658fa.log`). Independent same-model GPT-6 Luna read-only review returned one P2: the runtime role had unnecessary SELECT grants on `pipeline_stages` and `contacts`, while the integration used those grants to inspect parent preservation. Remediation removed both grants, asserts both privileges are false, and moves parent-table inventory to a separate disposable bootstrap audit connection.

After remediation, focused repository/account-guard Vitest passed 15/15; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/exact-grant checks, and `git diff --check` passed. Updated disposable PostgreSQL 16 forced-RLS integration passed with no residual resources. Final evidence: `validation-postgres-pipeline-deal-delete-e17e865366.log`. Fresh independent same-model GPT-6 Luna re-review returned `APPROVE`, zero findings, and zero caveats, limited to this deal-delete slice.

The repository deletes only one requested deal using the verified account context and minimum `agent` role, checks deal/pipeline creator consistency, and returns safe not-found for inaccessible rows. Keep the task `in_progress` and consumers unwired. No Supabase, message deletion, UI/API wiring, Auth/session, schema/grant/RLS changes, real credentials/data, traffic, production, commit, push, or deploy occurred. H-DATA-003/H-DB-003 are not approved overall.

## Schema relationship check

The migration corpus contains no foreign key referencing `public.deals`; deal rows reference parent pipeline/stage/contact records. The integration fixture measured row inventories before and after deletes and confirmed parent tables and unrelated deals remain intact.

## Independent read-only review

The first Luna review returned one P2 for excess runtime SELECT grants on contacts and stages. After removing them and moving parent inventory to a separate disposable audit connection, a fresh same-model GPT-6 Luna re-review returned exactly `APPROVE` with zero findings and zero caveats for this deal-delete slice only. H-DATA-003/H-DB-003, consumer wiring, Auth/session, Supabase, and production are not approved.
