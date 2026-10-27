# Task — PostgreSQL broadcast-detail read

- id: `20261020-023725-670d`
- type: `migration`
- slug: `postgres-broadcast-detail-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for one broadcast's detail header and recipient history.

## In scope

- Validate requested broadcast UUID; require verified account membership and transaction-local RLS identity.
- Scope the parent broadcast to the verified account and require its author profile to belong to that account.
- Return only fields used by the detail screen, including broadcast counts and status plus recipient status/timestamps/error and optional contact name/phone.
- Keep all recipients in legacy newest-first order; preserve missing/deleted contacts as null and only join a contact in the same account as its broadcast.
- Add focused unit tests and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No page/API wiring, send/delete/update, polling, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Consumers stay unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact minimum column SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats.

## Next action

Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats, limited to this broadcast-detail slice. Keep this task `in_progress`; continue with the separate approved-broadcast-template read repository slice.

## Worktree validation — 2026-10-20

- TDD RED confirmed module absence. Focused Vitest passed 17/17; TypeScript, targeted ESLint with zero warnings, Prettier on supported files, PowerShell AST/fixture forced-RLS and minimum-grant checks, and `git diff --check` passed.
- Initial Docker fixture setup stopped before integration because two synthetic profiles reused a UUID; the seed was corrected. Final disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with `NOBYPASSRLS`, exact column SELECT grants, synthetic account/creator/contact isolation, owner/agent/viewer access, complete deterministic recipient ordering, null contacts, UTC timestamps, safe DTO, `--network none`, tmpfs, read-only mounts, generated credentials, and cleanup verification. Evidence: `validation-postgres-broadcast-detail-cd3ec5357a.log`.
- No page/API wiring, sends/deletes/updates, polling, Supabase, Auth/session replacement, schema/grant/RLS edits, real data/credentials, application traffic, production, commit, push, or deploy. Consumers remain unwired; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero actionable findings, and zero caveats, limited to this broadcast-detail repository slice. H-DATA-003/H-DB-003 remain unapproved overall.
