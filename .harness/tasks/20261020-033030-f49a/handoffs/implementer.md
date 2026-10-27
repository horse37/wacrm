# Implementer handoff — PostgreSQL template lifecycle configuration read

## Start state

- Task 20261020-033030-f49a, status in_progress, H-DATA-003 phase 03.
- Repository C:\Sistemas\wacrm; branch main; expected HEAD 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c.
- Preserve all dirty/untracked files. Use PostgreSQL in disposable Docker Desktop only; never Supabase.
- No route wiring, token decryption, Meta calls, writes, commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only repository for template lifecycle configuration. The edit context returns only opaque encrypted access token. The delete context returns opaque encrypted access token and nullable WABA ID. Both methods derive account ID from verified membership, set auth.uid transaction-locally, use explicit account predicates and bound values, return null on no config, and fail closed on duplicates/malformed values.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, git diff --check, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with NOBYPASSRLS, exact minimum column grants, --network none, tmpfs, readonly mounts, synthetic opaque values/generated credentials, and cleanup verification. Get a fresh independent GPT-6 Luna read-only review; remediate and repeat until exact APPROVE with zero findings/caveats. Keep task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- Added template-lifecycle-config.ts and focused tests. Edit returns opaque encrypted access_token only; delete returns that value plus nullable waba_id. Both queries use verified account scope, bound account ID, transaction-local RLS identity, null-on-missing, and duplicate/malformed checks.
- TDD RED confirmed the repository module was absent. Vitest passed 9/9; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and git diff --check passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with NOBYPASSRLS, exact minimum column grants, synthetic account/config rows, --network none, tmpfs, readonly mounts, generated credentials, and no residual resources. Final evidence: validation-postgres-template-lifecycle-config-43b496b6f9.log.
- No decryption, route wiring, Meta calls, writes, Supabase, real credentials/data, application traffic, production, commit, push, or deploy.

## Completed first action

Focused TDD RED failed because the dedicated repository module was absent; its final 9 tests now pass.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero findings and zero caveats, limited to this repository slice. No route wiring, decryption, or Meta calls were reviewed or approved.

## Next action

Next task `20261020-033829-58ee` isolates the template-sync account/name/language match read. Keep lifecycle consumers unwired, this task in_progress, and H-DATA-003/H-DB-003 unapproved overall.
