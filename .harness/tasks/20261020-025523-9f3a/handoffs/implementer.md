# Implementer handoff — PostgreSQL template-editor detail read

## Start state

- Task `20261020-025523-9f3a`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve preexisting dirty/untracked files. Use disposable Docker Desktop PostgreSQL only; do not use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one unwired server-only read repository for fields that prefill the template editor. Validate UUID, require verified account/user scope and transaction-local identity, enforce creator/profile consistency, and return not-found for inaccessible rows. Strictly validate JSON buttons/sample values and return only form DTO fields; omit upload handles and Meta/error internals.

No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, application traffic, or production.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker PostgreSQL 16 forced-RLS integration with runtime `NOBYPASSRLS`, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic credentials/data, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE`, zero findings, and zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 stay unapproved overall.

## Next action

Implementation, TDD RED, focused validation, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration are complete. Vitest 18/18, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Integration evidence: `validation-postgres-template-editor-9fea5ff4c0.log`; cleanup found no residual task resources. Obtain fresh independent GPT-6 Luna read-only review and remediate/revalidate until APPROVE with zero findings/caveats. Keep task `in_progress`, consumers unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Implemented slice

- `src/lib/repositories/template-editor-detail.ts`: server-only detail query for the verified user/account; creator profile consistency; transaction-local RLS identity; parameterized UUID; safe not-found; strict category/header/button/sample JSON validation; minimal editor DTO.
- `src/lib/repositories/template-editor-detail.test.ts`: 18 focused cases including validation failures, missing scope, safe DB failure, null legacy fields, projection, and identity.
- `.harness/tasks/20261020-025523-9f3a/postgres-template-editor-detail-fixture.sql` and `scripts/testing/postgres-template-editor-detail-integration.mjs`: synthetic PostgreSQL fixture and forced-RLS integration proof.
- `scripts/testing/validate-postgres-template-editor-detail.ps1`: Docker Desktop-only runner using local images, `--network none`, tmpfs, read-only source mounts, generated credentials, and cleanup verification.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this repository slice. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
