# Task — PostgreSQL Settings Overview template counts

- id: `20261020-030636-d33a`
- type: migration
- slug: `postgres-settings-template-counts`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL read for total and pending template counts shown in Settings Overview.

## Context

H-DATA-003 phase 03. Template-list, editor-detail, broadcast-option, and automation-option repository reads have independent GPT-6 Luna approvals limited to each slice. Use disposable Docker Desktop PostgreSQL only; never use Supabase. Keep UI consumers unwired pending H-SELF-002/H-DB-003.

## In scope

- Preserve current Settings Overview counts for templates owned by the verified user: total and status `PENDING`.
- Require verified account membership and transaction-local `auth.uid()`; scope by verified account/user and require creator profile/user/account consistency.
- Return only validated nonnegative `total` and `pending` counts.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all preexisting local work. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `NOBYPASSRLS`, forced RLS, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress` and consumer unwired.

## Next action

Implementation and focused validation are complete. TDD RED first confirmed the repository module was absent. Added one unwired server-only aggregate read for the verified user's total and `PENDING` templates, with explicit account/user scope, creator-profile consistency, transaction-local RLS identity, and checked nonnegative integer counts. Vitest passed 10/10; TypeScript, targeted ESLint (zero warnings), Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with runtime `NOBYPASSRLS`, exact minimum column grants, per-user/account/creator isolation, null-status total semantics, `--network none`, tmpfs, read-only mounts, synthetic values/generated credentials, and no residual resources. Evidence: `validation-postgres-template-counts-a6818bad5d.log`. Next: obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected validation until APPROVE with zero findings/caveats. Keep task `in_progress` and consumer unwired.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/template-manager-counts.ts` and focused tests. One query returns per-user total and pending counts; mapper rejects malformed, negative, unsafe, and internally inconsistent values.
- TDD RED confirmed module absence. Focused Vitest passed 10/10; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed; PowerShell AST/fixture checks passed; `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, runtime `NOBYPASSRLS`, exact minimum column SELECT grants, per-user/account/creator isolation, null status counted only in total, transaction-local identity cleanup, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual task resources. Evidence: `validation-postgres-template-counts-a6818bad5d.log`.
- No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, app traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this template-count repository slice. H-DATA-003/H-DB-003 remain unapproved overall; harness task remains `in_progress`.
