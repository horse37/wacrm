# Task — PostgreSQL inbox approved-template picker read

- id: `20261020-031114-d904`
- type: migration
- slug: `postgres-inbox-approved-template-picker`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL read for the approved templates listed by the inbox picker.

## Context

Earlier H-DATA-003 phase 03 template reads have slice-limited independent GPT-6 Luna approvals. Use PostgreSQL in disposable Docker Desktop only; never Supabase. Keep UI consumers unwired pending H-SELF-002/H-DB-003.

## In scope

- Preserve current inbox picker semantics: templates owned by the verified user, `APPROVED` only, newest first with deterministic ID tie-break.
- Return a minimal validated DTO for picker display, body/header variable collection, preview, and selection; omit Meta identifiers and submission/error internals.
- Require verified account membership, explicit account/user predicates, transaction-local `auth.uid()`, and creator profile/account consistency.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all existing local work. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `NOBYPASSRLS`, forced RLS, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress` and consumer unwired.

## Next action

Implementation, focused validation, and disposable Docker Desktop PostgreSQL 16 integration are complete. TDD RED first confirmed the repository module was absent. Vitest passed 14/14; TypeScript, targeted ESLint (zero warnings), Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Forced-RLS Docker integration passed with runtime `NOBYPASSRLS`, exact minimum column grants, verified per-user/account scope, approved-only filtering, creator consistency, stable newest/UUID order, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual resources. Evidence: `validation-postgres-inbox-templates-4667d9bf3b.log`. Independent review returned `APPROVE`, zero findings/caveats, for this slice only. Next: isolate the remaining account/name/language template-definition read used by send paths. Keep consumer unwired, task `in_progress`, and H-DATA-003/H-DB-003 unapproved overall.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/inbox-approved-templates.ts` and focused tests. The unwired repository returns validated picker fields only, scopes to the verified account and template owner, checks creator profile consistency, sets transaction-local identity, filters `APPROVED`, and orders newest first with descending UUID tie-break.
- TDD RED confirmed module absence. Focused Vitest passed 14/14; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed; PowerShell AST/fixture checks passed; `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, runtime `NOBYPASSRLS`, exact minimum column SELECT grants, per-user/account isolation, approved-only behavior, creator join, stable order, minimal DTO, transaction-local identity cleanup, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual task resources. Evidence: `validation-postgres-inbox-templates-4667d9bf3b.log`.
- No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, app traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this inbox-template repository slice. H-DATA-003/H-DB-003 remain unapproved overall; harness task remains `in_progress`.
