# Task — PostgreSQL approved automation-template options

- id: `20261020-030243-8e57`
- type: migration
- slug: `postgres-approved-automation-template-options`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL read for approved template options in the automation builder.

## Context

H-DATA-003 phase 03. The broadcast-template list, template-manager catalog, and template-editor detail reads have independent GPT-6 Luna approvals limited to each slice. Use disposable PostgreSQL in Docker Desktop only; never use Supabase. Keep UI consumers unwired pending H-SELF-002/H-DB-003.

## In scope

- Preserve the automation builder's approved-only, account-member option list and alphabetical order.
- Require verified account membership and transaction-local `auth.uid()`; scope by verified account and require creator profile/account consistency.
- Return only validated `id`, `name`, and nullable `language`; keep result unbounded with stable ID tie-break.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all preexisting local work. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `NOBYPASSRLS`, forced RLS, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress` and consumer unwired.

## Next action

Implementation and focused validation are complete. TDD RED first confirmed the repository module was absent. Added an unwired server-only account-scoped approved-template option read with creator consistency, transaction-local identity, and minimal DTO. Vitest passed 8/8; TypeScript, targeted ESLint (zero warnings), Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with runtime `NOBYPASSRLS`, exact minimum column grants, account-member visibility, approved-only filtering, creator consistency, stable alphabetical/UUID order, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual resources. Evidence: `validation-postgres-approved-automation-templates-b98b4cfa98.log`. Next: obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected validation until APPROVE with zero findings/caveats. Keep task `in_progress` and consumer unwired.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/approved-automation-templates.ts` with verified account scope, transaction-local RLS identity, approved-only filter, matching creator profile/account, alphabetical order with UUID tie-break, and minimal `id`, `name`, nullable `language` DTO.
- TDD RED confirmed module absence. Focused Vitest passed 8/8; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed; PowerShell AST/fixture checks passed; `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, runtime `NOBYPASSRLS`, exact minimum SELECT grants, account-member visibility, approved-only filtering, creator consistency, stable ordering, minimal DTO, transaction-local identity cleanup, `--network none`, tmpfs, read-only source mounts, synthetic fixtures/generated credentials, and no residual task resources. Evidence: `validation-postgres-approved-automation-templates-b98b4cfa98.log`.
- No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, app traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this approved automation-template option repository slice. H-DATA-003/H-DB-003 remain unapproved overall; harness task remains `in_progress`.
