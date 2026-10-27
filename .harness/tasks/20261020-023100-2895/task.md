# Task — PostgreSQL broadcast-list read

- id: `20261020-023100-2895`
- type: `migration`
- slug: `postgres-broadcast-list-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for the broadcast list-card fields.

## In scope

- Verify account membership, set transaction-local RLS identity, explicitly scope `broadcasts.account_id`, and require the broadcast author's profile to match that account.
- Return only validated fields consumed by the list screen: ID, name, template name, status, total recipients, delivered/read counts, and UTC creation timestamp.
- Preserve all visible broadcasts and sort newest first with a deterministic UUID tie-break.
- Add unit tests and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No route/page wiring, broadcast writes or sends, status changes, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Consumers remain unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact minimum column SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Next action

Continue with the separate broadcast-detail/recipient read slice; keep this task `in_progress` and its consumers unwired.

## Worktree validation — 2026-10-20

- TDD RED confirmed the module was absent. Focused Vitest passed 11/11; TypeScript, targeted ESLint with zero warnings, Prettier on supported files, PowerShell AST/fixture forced-RLS and minimum-grant checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with runtime `NOBYPASSRLS`, forced RLS on accounts/profiles/broadcasts, exact column SELECT grants, synthetic owner/agent/viewer account isolation and author consistency, stable unbounded order, UTC timestamps, sensitive-field omission, transaction identity cleanup, `--network none`, tmpfs, read-only mounts, generated credentials, no published ports/named volumes, and no residual containers. Evidence: `validation-postgres-broadcast-list-287c1f3540.log`.
- No API/UI wiring, writes/sends, Supabase, Auth/session replacement, repository schema/grant/RLS changes, real data/credentials, application traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this repository slice only. H-DATA-003/H-DB-003 remain unapproved overall.
