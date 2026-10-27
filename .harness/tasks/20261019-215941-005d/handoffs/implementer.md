# Implementer handoff — H-DATA-003 PostgreSQL account members repository

## Start state

- Task: `20261019-215941-005d`, `postgres-account-members-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and prior task artifacts.
- Database target: synthetic PostgreSQL in task-owned disposable Docker Desktop resources. Do not use Supabase.

## Scope boundary

H-DATA-003's first repository priority is profile/account. Implement only read-only account-member listing behind the verified-session PostgreSQL guard. The Auth provider/policy is not ready, so do not wire current routes or pages; the existing Supabase-backed member endpoint stays unchanged. No production grants or migrations.

## Progress

- Created a narrow task for the first H-DATA-003 profile/account repository slice.
- H-DATA-002 guard slice has a same-model Luna `APPROVE`, zero findings/caveats after P2 remediation; that does not approve the whole H-DATA-002 task.
- Added `src/lib/repositories/account-members.ts`. It internally requires the default PostgreSQL account guard, sets transaction-local RLS identity, and queries profiles with explicit parameterized account scope.
- Preserved current member projection: admin/owner sees email; agent/viewer sees `null`; caller role is read in the same SQL snapshot as member rows; unknown roles are omitted.
- Existing Supabase member route remains unchanged and unwired. No Auth/session policy, permanent grant, RLS migration, or other repository was changed.

## Validation

- TDD RED: first focused run failed because the repository module was absent.
- Focused Vitest — SUCCESS, 41/41: `node node_modules/vitest/vitest.mjs run src/lib/repositories/account-members.test.ts src/lib/auth/postgres-account-guard.test.ts src/lib/auth/roles.test.ts`.
- TypeScript, targeted ESLint with zero warnings, and Prettier check — SUCCESS.
- Disposable PostgreSQL Docker proof — SUCCESS, final log `validation-postgres-account-members-5501c04534.log`; PostgreSQL 16/Node 22, `--network none`, tmpfs, read-only repository mount, synthetic two-account fixture, explicit RLS/account-scope checks, no published ports/volumes, no residual resources.
- `git diff --check` — SUCCESS after final records; only existing line-ending normalization warnings. No trailing whitespace in new SQL/MJS/PowerShell files.

## Limits

- The minimal fixture follows the existing `profiles`/`accounts` and RLS semantics but does not execute the complete migration chain.
- No session provider, current route, Supabase service, other domain repository, Storage, Realtime, production grant, or production environment was exercised.

## Independent read-only review

- Same-model Luna reviewer returned `APPROVE`, zero findings/caveats for this member-repository slice.
- Reviewer confirmed explicit account predicate/parameters, transaction-local identity, same-snapshot role/email projection, two-tenant isolation, and that the Supabase route remains unchanged.
- Review made no edits and ran no tests. Approval does not complete the HARNESS task or H-DATA-003; route wiring/provider and remaining repositories remain separate.

## Next action

Proceed to the next narrow H-DATA-003 profile/account repository slice in PostgreSQL/Docker Desktop. Keep this task `in_progress`; route wiring remains blocked on a separately approved verified-session provider.
