# Implementer handoff — H-DATA-003 PostgreSQL account rename repository

## Start state

- Task: `20261019-220632-41dc`, `postgres-account-rename-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty work and all prior task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Move only the account-rename database operation into a new server-only repository. The caller supplies already validated account name; route validation, rate limit, and HTTP handling remain unchanged and are not wired yet. Repository gets account ID and role from the default verified-session guard, and relies on existing migration 017 RLS as defense in depth.

## Progress

- Opened the next narrow H-DATA-003 profile/account slice after member-listing repository received independent Luna `APPROVE`, zero findings/caveats.
- Added `src/lib/repositories/accounts.ts`, server-only account rename backed by the default PostgreSQL guard. Requires admin-or-higher, sets verified user ID as transaction-local RLS identity, updates only bound account ID, and returns ID/name.
- Added focused unit tests and a two-account forced-RLS PostgreSQL fixture/runner. Docker proof uses synthetic values, `NOBYPASSRLS`, `--network none`, tmpfs, read-only repo mounts, no published ports/named volumes; it passed and left no task resources. Evidence: `.harness/tasks/20261019-220632-41dc/validation-postgres-account-rename-f3e7753de3.log`.
- Focused Vitest 42/42, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, and Docker PostgreSQL integration all passed. Initial Prettier check found two formatting-only issues; formatted and reran the full focused validation successfully.
- No Supabase or existing routes were touched. H-SELF-002 session provider/policy remains absent, so repository is not wired. No commit, push, or deploy.
- Independent same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this rename slice. Reviewer verified main/expected HEAD/task state, guard-derived account/identity, role enforcement, parameterized update, RLS, and the recorded Docker proof. Review made no edits and ran no tests.

## Next action

Proceed to the next narrow PostgreSQL account repository slice: read outstanding invitations without selecting or exposing `token_hash`. Keep this task `in_progress`; do not wire routes before separately approved verified-session work.
