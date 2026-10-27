# Task — PostgreSQL flow-run list

- id: `20261020-021450-d087`
- type: `migration`
- slug: `postgres-flow-run-list`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository for the 50 newest runs of one flow, with optional same-account contact summaries.

## In scope

- Require verified account membership, set transaction-local RLS identity, and validate the requested flow UUID.
- Load the flow by ID and verified account, checking its creator profile belongs to that account.
- Load at most 50 runs for that flow and account, requiring the run's creator to match the flow author and a same-account profile.
- Return the run-history screen's minimal flow/run fields, including contact id/name/phone only when joined inside the verified account; validate every output field and order by `started_at DESC, id DESC`.
- Add focused Vitest tests and disposable PostgreSQL 16 forced-RLS Docker Desktop evidence.

## Out of scope

No event timeline, route/page wiring, writes, flow-engine changes, Auth/session replacement, schema/grant/RLS changes, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Consumers stay unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, exact column SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data, no published ports/named volumes, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Worktree validation — 2026-10-20

- TDD RED confirmed the repository module was absent. Focused flow-run-list Vitest passed 17/17; TypeScript, targeted ESLint with zero warnings, Prettier on supported files, PowerShell AST and forced-RLS/minimum-grant fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with runtime `NOBYPASSRLS`, forced RLS on accounts/profiles/flows/runs/contacts, exact column SELECT grants, read-only repository mounts, `--network none`, tmpfs, generated synthetic credentials, no published ports/named volumes, and no residual containers. It verified account/flow/run-author consistency, same-account optional contacts, 50-row cap, stable tie ordering, minimal DTO, hidden not-found, and transaction-local identity cleanup. Final evidence: `validation-postgres-flow-run-list-346af3b7da.log`.
- No API/UI wiring, event reads, Supabase, writes, Auth/session replacement, schema/grant/RLS changes, real data/credentials, application traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this repository slice only. H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Continue with a separate narrow PostgreSQL flow-run-event read slice; keep consumers unwired and H-DATA-003/H-DB-003 unapproved overall.
