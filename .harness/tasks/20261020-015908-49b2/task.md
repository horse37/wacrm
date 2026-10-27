# Task — PostgreSQL flow list

- id: `20261020-015908-49b2`
- type: `migration`
- slug: `postgres-flow-list`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository for the flow list in the verified account.

## Context

Automation list, logs, and editor-load repositories received slice-limited GPT-6 Luna `APPROVE`. The existing `GET /api/flows` reads `public.flows` under account-member RLS and the list page consumes a small subset of the row. Use disposable PostgreSQL in Docker Desktop only; no Supabase. Keep route and UI consumers unwired pending H-SELF-002/H-DB-003.

## In scope

- Require verified account membership and set transaction-local RLS identity.
- List only flows whose creator profile is consistent with the flow account, scoped by the verified account.
- Return only the fields used by the list screen: id, name, description, status, trigger type/config, and execution count.
- Validate IDs, enums, JSON object, nullable description, and non-negative execution count; preserve newest-first ordering with stable ID tie-break.

## Out of scope

No UI/API wiring, flow writes, nodes, runtime runs/events, Auth/session replacement, schema/grant/RLS changes, Supabase, Storage, Realtime, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Start with red focused Vitest for access, DTO, account/creator isolation, ordering, malformed values, UUID, and pooled identity behavior.
- Run focused repository/account-guard tests, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Prove account isolation and mapping against disposable PostgreSQL 16 in Docker Desktop with forced RLS, runtime `NOBYPASSRLS`, minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, generated synthetic credentials, no ports/named volumes, and cleanup assertion.
- Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings and caveats.

## Handoff

Keep this task `in_progress`, keep consumers unwired, and do not claim H-DATA-003/H-DB-003 approval. Use only Docker Desktop PostgreSQL and synthetic fixtures. Never use Supabase or production.

## Worktree result — 2026-10-20

Implemented `src/lib/repositories/flow-list.ts` as a server-only read. It requires verified account membership, sets transaction-local identity, filters by account, and requires a creator profile matching the flow account. The projection contains only fields consumed by the list UI, omitting `entry_node_id`, fallback policy, timestamps, and IDs used only for tenancy. It validates UUIDs, status/trigger enums, JSON object shape, and non-negative integer execution counts; order is newest `created_at` with UUID tie-break.

TDD red initially failed because the repository module did not exist. Focused repository/account-guard tests passed 19/19; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/forced-RLS fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, `NOBYPASSRLS`, exact column SELECT grants, no write grants, no access to entry node/fallback/last-execution/update timestamps/profile name, synthetic owner/agent/viewer accounts, creator/account isolation, stable ordering, `--network none`, tmpfs, readonly mounts, generated passwords, no ports/named volumes, and no residual task resources. Evidence: `.harness/tasks/20261020-015908-49b2/validation-postgres-flow-list-19d4c7bc9e.log`.

No UI/API wiring, flow writes, nodes, runs/events, Supabase, Auth/session, schema/grant/RLS changes, real data, traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Continue with the next narrow H-DATA-003 repository slice. Keep consumers unwired and this task `in_progress`.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats, limited to this flow-list slice. H-DATA-003/H-DB-003 remain unapproved overall.
