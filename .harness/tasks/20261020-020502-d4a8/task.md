# Task — PostgreSQL flow editor load

- id: `20261020-020502-d4a8`
- type: `migration`
- slug: `postgres-flow-editor-load`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository that loads a flow and its nodes for the verified account.

## Context

The flow-list repository has slice-limited GPT-6 Luna approval. Migration 017's existing SELECT policies allow account members to read flows and nodes. Use PostgreSQL in disposable Docker Desktop only; keep route/page consumers unwired pending H-SELF-002/H-DB-003.

## In scope

- Require verified account membership and transaction-local RLS identity.
- Validate flow UUID and fail closed on malformed rows.
- Query one flow and its nodes only inside the verified account; require same-account creator profile consistency.
- Return editor-consumed fields only, with stable node order by `created_at`, then UUID.
- Add focused unit and disposable PostgreSQL 16 forced-RLS integration proof.

## Out of scope

No route/page wiring, writes, flow runs/events, Auth/session replacement, schema/grant/RLS changes, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- Focused Vitest, TypeScript, targeted ESLint with `--max-warnings=0`, Prettier check, PowerShell AST/fixture checks, and `git diff --check`.
- Docker Desktop PostgreSQL 16 with forced RLS, runtime `NOBYPASSRLS`, minimum column SELECT grants, synthetic accounts, `--network none`, tmpfs, read-only mounts, generated credentials, no published ports/named volumes, and cleanup assertion.
- Fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Next action

Obtain independent same-model GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Worktree validation — 2026-10-20

- TDD RED confirmed the repository module was absent. Focused flow-editor/account-guard tests passed 20/20; TypeScript, targeted ESLint with zero warnings, Prettier on supported files, PowerShell AST/fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with runtime `NOBYPASSRLS`, exact column SELECT grants, no writes, owner/agent/viewer access, cross-account denial, creator-profile consistency, deterministic node ordering, minimal DTO, `--network none`, tmpfs, read-only mounts, generated passwords, no ports/named volumes, and no residual containers. Evidence: `validation-postgres-flow-editor-load-df54197bc5.log`.
- No API/UI wiring, Supabase, writes, Auth/session replacement, schema/grant/RLS changes, real data/credentials, traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats, limited to this slice. Its first P2 about the previous pool snapshot was withdrawn after verifying that `.harness/current-task.md` and its 1,186-line diff were already dirty before this task; no preexisting history change belongs to this slice. H-DATA-003/H-DB-003 remain unapproved overall.
