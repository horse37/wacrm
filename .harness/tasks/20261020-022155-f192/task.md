# Task — PostgreSQL flow-run event list

- id: `20261020-022155-f192`
- type: `migration`
- slug: `postgres-flow-run-event-list`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository for event timelines belonging to the 50 newest runs of one flow.

## In scope

- Require verified account membership, transaction-local RLS identity, a valid flow UUID, and same-account flow-author consistency.
- Select runs only for the requested flow and verified account, requiring run author and same-account profile consistency; then return events only for those 50 newest runs.
- Return the event-history screen's minimal fields (`flow_run_id`, `event_type`, `node_key`, `payload`, `created_at`), validate rows, and order by timestamp then event UUID for deterministic ties.
- Preserve the existing complete event timeline for these 50 runs. This repository-only slice does not add pagination or an event-count cap.
- Add focused Vitest tests and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No route/page wiring, event writes, engine changes, Auth/session replacement, repository migration/schema/grant/RLS changes, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Consumers remain unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact column SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data, no published ports/named volumes, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Next action

Continue with the next narrow H-DATA-003 PostgreSQL read repository slice while leaving consumers unwired; this task remains `in_progress`.
## Worktree validation — 2026-10-20

- TDD RED confirmed the repository module was absent. Focused flow-run-event Vitest passed 15/15; TypeScript, targeted ESLint with zero warnings, Prettier on supported files, PowerShell AST and forced-RLS/minimum-grant fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with runtime `NOBYPASSRLS`, forced RLS on accounts/profiles/flows/runs/events, exact column SELECT grants, read-only repository mounts, `--network none`, tmpfs, generated synthetic credentials, no published ports/named volumes, and no residual containers. It verified flow/account/creator consistency, selected only events for the 50 newest runs, preserved complete timelines, ordered timestamp ties by event UUID, omitted internal fields, hid inaccessible flows, and reset transaction-local identity. Final evidence: `validation-postgres-flow-run-event-list-0cf7dc3715.log`.
- No API/UI wiring, event writes, Supabase, Auth/session replacement, repository schema/grant/RLS changes, real data/credentials, application traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall. This slice preserves all events for each selected run without pagination or a per-run cap.

## Independent review

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this repository slice only. H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Continue the next narrow H-DATA-003 PostgreSQL read slice; do not wire consumers or mark this task complete.
