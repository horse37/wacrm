# Implementer handoff — PostgreSQL Settings Overview template counts

## Start state

- Task `20261020-030636-d33a`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve preexisting dirty/untracked files. Use disposable Docker Desktop PostgreSQL only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one unwired server-only aggregate read for the two Settings Overview template counts. Preserve per-user semantics for total and `PENDING`, scope by verified account/user, set RLS identity transaction-locally, and require creator profile consistency. Return only safe nonnegative counts.

No UI/API wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real data/credentials, application traffic, or production.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with runtime `NOBYPASSRLS`, exact minimum column grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate and revalidate until `APPROVE`, zero findings, zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Implementation, TDD RED, focused validation, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration are complete. Vitest 10/10, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Evidence: `validation-postgres-template-counts-a6818bad5d.log`; cleanup found no residual task resources. Obtain fresh independent GPT-6 Luna read-only review and remediate/revalidate until APPROVE with zero findings/caveats. Keep task `in_progress`, consumer unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Implemented slice

- `src/lib/repositories/template-manager-counts.ts` and `.test.ts`: per-user total/pending aggregate with verified account/user scope, creator consistency, transaction identity, safe integer parsing, and invariant checks.
- `.harness/tasks/20261020-030636-d33a/postgres-template-manager-counts-fixture.sql` and `scripts/testing/postgres-template-manager-counts-integration.mjs`: synthetic forced-RLS proof, including null status and cross-user/account rows.
- `scripts/testing/validate-postgres-template-manager-counts.ps1`: Docker Desktop-only runner with local images, `--network none`, tmpfs, readonly repository mounts, generated credentials, and cleanup verification.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats for this slice only. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
