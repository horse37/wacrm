# Implementer handoff — PostgreSQL inbox approved-template picker

## Start state

- Task `20261020-031114-d904`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve preexisting dirty/untracked files. Use disposable Docker Desktop PostgreSQL only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one unwired server-only read for the inbox's approved templates. Preserve verified per-user scope, explicit account/user predicates, creator profile consistency, transaction-local RLS identity, approved-only filter, newest-first order with stable ID tie-break, and only fields needed by the picker. No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS edits, real data/credentials, app traffic, or production.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with runtime `NOBYPASSRLS`, exact minimum column grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate and revalidate until `APPROVE`, zero findings, zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Implementation and listed focused validation are complete. TDD RED confirmed module absence; Vitest passed 14/14, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `validation-postgres-inbox-templates-4667d9bf3b.log`; cleanup found no residual resources. Independent review returned `APPROVE`, zero findings/caveats, for this slice only. Next: isolate the remaining account/name/language template-definition read used by send paths. Keep consumer unwired, task `in_progress`, and H-DATA-003/H-DB-003 unapproved overall.

## Implemented slice

- `src/lib/repositories/inbox-approved-templates.ts` and `.test.ts`: verified per-user/account approved-template list, creator/profile consistency, transaction-local identity, deterministic newest-first order, strict picker DTO validation, and safe database error handling.
- `.harness/tasks/20261020-031114-d904/postgres-inbox-approved-templates-fixture.sql` and `scripts/testing/postgres-inbox-approved-templates-integration.mjs`: synthetic forced-RLS integration with least column grants, account/user isolation, approved-only filter, tie-break order, minimal result, and pooled identity cleanup.
- `scripts/testing/validate-postgres-inbox-approved-templates.ps1`: Docker Desktop-only runner using local images, `--network none`, tmpfs, readonly repo mounts, generated credentials, PowerShell AST/fixture checks, and cleanup verification.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats for this slice only. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
