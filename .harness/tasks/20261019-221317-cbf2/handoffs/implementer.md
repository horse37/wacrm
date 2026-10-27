# Implementer handoff — PostgreSQL outstanding account invitations repository

## Start state

- Task: `20261019-221317-cbf2`, `postgres-account-invitations-read-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty work and all prior task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only a server-only read repository behind the existing injected verified-session guard. Query `public.account_invitations` using the guard-derived `accountId`, requiring `admin` or higher. Return only the fields already published by `GET /api/account/invitations`; never select or expose stored `token_hash`. Existing route remains untouched/unwired. No invitation writes or schema/privilege changes.

## Progress

- Opened as the next narrow H-DATA-003 slice after account-member listing and account rename repositories received slice-limited independent `APPROVE` reviews.
- Read the existing route contract and migration 017 table/RLS shape. The route lists unaccepted rows with `expires_at > now()`, orders by `created_at DESC`, and omits `token_hash`.
- Added `src/lib/repositories/account-invitations.ts`. It requires admin+, sets the verified user identity transaction-locally, uses the guard-derived account ID, and returns only the allowlisted fields from the existing GET contract. The SQL never selects the stored token hash.
- Added focused tests and a two-account forced-RLS PostgreSQL fixture/runner. TDD RED confirmed the repository was missing; final focused Vitest passed 54/54.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, and Docker PostgreSQL integration passed. Docker evidence: `.harness/tasks/20261019-221317-cbf2/validation-postgres-account-invitations-6b9c6b1532.log`; no residual task resources.
- PostgreSQL proof uses synthetic data, `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, and no published ports/named volumes. It covers account isolation, admin denial, accepted/expired filtering, ordering, hash exclusion, missing session, and transaction-local identity cleanup.
- No Supabase or route wiring, invitation writes, permanent grant/schema change, production data, commit, push, or deploy.
- Independent same-model Luna read-only review returned `APPROVE`, zero findings/caveats, for this read-only invitations slice. Review checked branch/HEAD/task status, query scope/parameters/filters/order, token hash exclusion, and Docker evidence; it made no edits and ran no tests.

## Next action

Proceed to the next narrow PostgreSQL invitation slice: create using validated role/expiry data and caller-generated token hash. Keep task `in_progress`; route remains unwired pending verified-session integration and least-privilege grants.
