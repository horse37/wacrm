# Implementer handoff — PostgreSQL account-scoped template send definition

## Start state

- Task `20261020-031751-9e7d`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve preexisting dirty/untracked files. Use disposable Docker Desktop PostgreSQL only; never Supabase.
- No actual sends, Meta calls, commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one server-only account/name/language template lookup with verified account guard, transaction-local identity, creator profile/account join, minimal validated send DTO, null-on-missing, and conflict-on-ambiguous. Preserve current default `en_US` and do not introduce new status filtering. Keep both send-path consumers unwired.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with runtime `NOBYPASSRLS`, exact minimum grants, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate/revalidate until `APPROVE`, zero findings, zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Implementation and focused validation are complete. TDD RED confirmed module absence; Vitest passed 22/22, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `validation-postgres-template-send-81e8e8dad8.log`; cleanup found no residual resources. Independent review returned `APPROVE`, zero findings/caveats, for this slice only. Next: isolate the account-scoped template context read used by template lifecycle handlers. Keep consumers unwired; task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implemented slice

- `src/lib/repositories/template-send-definition.ts` and `.test.ts`: verified account-scoped exact name/language lookup, default `en_US`, creator consistency, transaction-local identity, duplicate-match conflict, and minimal validated send-builder DTO.
- `.harness/tasks/20261020-031751-9e7d/postgres-template-send-definition-fixture.sql` and `scripts/testing/postgres-template-send-definition-integration.mjs`: synthetic forced-RLS integration, least column grants, unique and ambiguous account-level matches, minimal DTO, and pooled identity cleanup.
- `scripts/testing/validate-postgres-template-send-definition.ps1`: Docker Desktop-only runner using local images, network isolation, tmpfs, readonly repo mounts, generated credentials, PowerShell AST/fixture checks, and cleanup verification.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats for this slice only. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
