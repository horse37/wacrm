# Task — PostgreSQL automation editor load

- id: `20261020-014934-7b2e`
- type: `migration`
- slug: `postgres-automation-editor-load`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository that loads an automation's editor fields and nested steps for the verified account.

## Context

The automation list and execution-log read repositories received slice-limited GPT-6 Luna `APPROVE`. The editor currently loads `automations` and `automation_steps` through a Supabase-backed route. Preserve that consumer unwired until H-SELF-002/H-DB-003 approve the applicable integration and database policy. Validate only synthetic fixtures in disposable Docker Desktop PostgreSQL; no Supabase.

## In scope

- Require verified account membership and validate the automation UUID.
- Set transaction-local RLS identity; resolve the automation by verified account and verify creator profile/account consistency.
- Preserve existing editor GET ownership: the verified user must be the automation creator; membership in the same account alone does not grant editor-config access.
- Return only the editor fields: id, name, description, trigger type/config, active state, and nested step tree.
- Read step id, parent id, branch, type, config, and position for the automation; order siblings deterministically and reject malformed/cross-automation tree relationships instead of silently dropping rows.
- Validate database payloads before returning the DTO.

## Out of scope

No UI/API wiring, automation or step writes, execution engine/pending work, Auth/session replacement, schema/grant/RLS changes, Supabase, Storage, Realtime, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Start with red focused Vitest for access, DTO projection, step-tree ordering, malformed and cross-parent data, UUID and pool identity behavior.
- Run focused repository/account-guard tests, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Prove account isolation and tree behavior against disposable PostgreSQL 16 in Docker Desktop with forced RLS, `NOBYPASSRLS`, minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, generated synthetic credentials, no ports/named volumes, and cleanup assertion.
- Obtain fresh independent GPT-6 Luna read-only review; minimally remediate and repeat affected checks/review until `APPROVE` with zero findings and caveats.

## Handoff

Keep this task `in_progress`, keep consumers unwired, and do not claim H-DATA-003/H-DB-003 approval. Use only Docker Desktop PostgreSQL with disposable synthetic data. No Supabase or production connection.

## Worktree result — 2026-10-20

Implemented `src/lib/repositories/automation-editor.ts` as a server-only read. It loads only the editor fields after verifying account membership, transaction-local identity, creator/profile account consistency, and that the verified user is the automation creator, preserving the existing editor GET boundary. Step rows are scoped to the automation/account, validated, ordered by position and UUID, and assembled into yes/no branches. Missing, cross-automation, non-condition, cyclic, or malformed relationships fail closed. Legacy null child branches remain mapped to `yes`, matching the existing editor loader.

The focused repository plus account-guard suite passed 20/20; TypeScript and targeted ESLint (`--max-warnings=0`) passed. Prettier passed for supported TypeScript/JavaScript/Markdown files; PowerShell AST and forced-RLS fixture checks passed; `git diff --check` passed before final record update. TDD red initially failed because the repository module did not yet exist. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with `NOBYPASSRLS`, exact column grants, no automation execution-count/timestamp or profile-name grant, no write grants, `--network none`, tmpfs, readonly mounts, generated synthetic passwords, no ports/named volumes, and no residual resources. It covers creator-only editor access, non-creator viewer/agent denial, account/creator isolation, nested branch order, legacy null branch, cross-automation parent rejection, empty automation, minimal DTO, and pooled GUC cleanup. Final evidence: `.harness/tasks/20261020-014934-7b2e/validation-postgres-automation-editor-59513bf5f0.log`. Earlier run `validation-postgres-automation-editor-888e474fbe.log` is preserved but superseded because it preceded the creator-only query filter.

No UI/API wiring, writes, engine/pending work, Supabase, Auth/session, schema/grant/RLS changes, real data, traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Continue with the next narrow H-DATA-003 repository slice. Keep consumers unwired and this task `in_progress`.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats, limited to this automation-editor-load slice. H-DATA-003/H-DB-003 remain unapproved overall.
