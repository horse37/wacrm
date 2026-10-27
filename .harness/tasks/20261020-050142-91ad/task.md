# Task — PostgreSQL flow-delete persistence

- id: `20261020-050142-91ad`
- type: `migration`
- slug: `postgres-flow-delete-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository for deleting only a flow owned by the verified agent account member.

## Context

`DELETE /api/flows/[id]` currently verifies caller ownership and then deletes through the Supabase admin client. The PostgreSQL flow editor read repository already uses verified account identity; migration 017 limits flow deletion to agent-level account members. Child graph/run/event rows are database-cascaded. Use Docker Desktop PostgreSQL only; never Supabase.

## In scope

- Require verified agent membership and derive owner/account IDs from the session and PostgreSQL membership.
- Parameterized delete matching flow ID, verified owner user ID, and account ID; return a safe outcome for missing, cross-account, and non-owned flows.
- Prove exact flow DELETE grant, forced RLS, `NOBYPASSRLS`, account/owner isolation, cascade behavior, concurrency, and identity cleanup with synthetic rows in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, flow graph edits, provider calls, schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve existing local changes; keep the task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Focused Vitest begins red and then passes; run TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run the task-owned forced-RLS PostgreSQL 16 integration in Docker Desktop with runtime `NOBYPASSRLS`, minimum grants, synthetic rows, generated credentials, `--network none`, tmpfs, read-only mounts, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Flow-delete repository slice received independent GPT-6 Luna read-only `APPROVE`, zero findings, and zero caveats. Continue with the next isolated flow persistence slice; keep routes unwired.

## Implementation and validation

- TDD RED confirmed the repository was absent; focused Vitest passed 7/7. TypeScript, targeted ESLint with `--max-warnings=0`, Prettier, and `git diff --check` passed.
- Added an unwired server-only delete requiring verified agent membership. The parameterized delete matches flow ID, session owner, and verified account in one transaction with transaction-local RLS identity; missing, non-owned, and cross-account rows return safe `not_found`.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS across accounts, profiles, flows, nodes, runs, and events; runtime `NOBYPASSRLS`; exact minimum column SELECT and flow DELETE grants; no child table grants; agent/owner/account checks; concurrent deletion; identity cleanup; and bootstrap verification that the node, run, and event cascade while unrelated flows remain. Synthetic-only data, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual containers. Evidence: `validation-postgres-flow-delete-14d009222b.log`.
- No route wiring, Supabase, Auth/session migration, provider call, real data/credentials, application traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent read-only review

- Independent GPT-6 Luna reviewer returned exact `APPROVE`, zero findings, and zero caveats for this flow-delete persistence slice only.
- The review scope is limited to the unwired repository, focused tests, disposable PostgreSQL fixture/runner, and recorded validation. It does not approve route wiring, H-DATA-003/H-DB-003 overall, Auth/session migration, Supabase replacement, Storage, Realtime, application traffic, or production.
- Task remains `in_progress`; no commit, push, or deploy occurred.
