# Implementer handoff — H-DATA-002 PostgreSQL account/role guard

## Start state

- Task: `20261019-214717-04f2`, `postgres-account-role-guard`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all pre-existing dirty work, including H-DATA-001 and H-DB migration-runner artifacts.
- Database target: PostgreSQL in task-owned disposable Docker Desktop resources only. Do not use Supabase.

## Scope boundary

The existing `src/lib/auth/account.ts` and its active consumers remain Supabase-backed. This task adds a separate provider-neutral guard contract that accepts a server-only verified-session resolver and reads matching membership from PostgreSQL. No routes/pages are wired until H-SELF-002 supplies an approved verified session provider and policy. Domain repository migration, RLS/grants, and production remain out of scope.

## Progress

- Task opened after H-DATA-001 slice review returned `APPROVE`; that earlier approval is limited to H-DATA-001.
- Existing account model is single-account-per-profile (`profiles.user_id` unique, `account_id`, `account_role`; `accounts.id/name`), introduced by migrations 001/017.
- Added `src/lib/auth/postgres-account-guard.ts`: server-only verified-session resolver, PostgreSQL membership lookup, `requireAccount()`, and `requireRole(minRole)`. The lookup is parameterized and sets the existing `auth.uid()` claim GUC inside `withTransaction` so RLS runs for the verified user and the setting cannot leak through the pool.
- Added focused tests for unauthenticated and missing membership denial, mismatched identity, invalid role, minimum role, error propagation, bound SQL, and RLS context setup.
- Updated `docs/project-map.md` with the rule that account-owned SQL reads/writes must carry the verified account scope.
- Existing Supabase-backed auth helper/routes were not edited. H-SELF-002 has not selected/implemented the verified session provider or application session policy; H-DB-003 has not approved deployment-role table grants. This code is not wired into the application.

## Validation

- Focused Vitest — SUCCESS, 36/36: `node node_modules/vitest/vitest.mjs run src/lib/auth/postgres-account-guard.test.ts src/lib/auth/roles.test.ts`.
- TypeScript — SUCCESS: `node node_modules/typescript/bin/tsc --noEmit`.
- Targeted ESLint — SUCCESS, zero warnings/errors.
- Prettier check — SUCCESS for changed TS/MJS and task/project docs.
- Disposable PostgreSQL Docker proof — SUCCESS, log `validation-postgres-account-guard-2b84013215.log`; PostgreSQL 16, `--network none`, tmpfs, `--rm`, read-only mount, no ports/volumes; synthetic least-privilege `NOBYPASSRLS` runtime role, RLS allow/deny, and transaction-local identity reset.
- `git diff --check` — SUCCESS; only line-ending normalization warnings.
- Limits: fixture is minimal, not the full migration chain; temporary auth.uid compatibility shim and table grants were test-only; no Auth provider, route consumer, production grant, Supabase service, or production was exercised.

## Independent review remediation — P2

- First independent read-only review returned `REMEDIATION_REQUIRED`: exported `findPostgresAccountMembershipByUserId(userId)` accepted arbitrary identity and set the RLS identity GUC. The lookup is now private.
- Test now invokes the default guard using a server-verified resolver and checks that both transaction-local GUC and membership query are bound to that resolved user ID.
- After remediation: focused Vitest 36/36, TypeScript, targeted ESLint with zero warnings, Prettier, and Docker PostgreSQL integration all passed. Latest integration evidence: `validation-postgres-account-guard-00e3c78e41.log`.
- Independent read-only re-review is pending. Keep task `in_progress`; no whole-task approval. H-SELF-002 session-provider policy, H-DB-003 deployment grants/context, and consumer migration remain separate prerequisites.

## Independent read-only re-review — P2 closure

- Same-model Luna reviewer returned `APPROVE` with zero findings and zero caveats for this H-DATA-002 guard slice.
- Review confirmed the database lookup is private and the tested default-guard path binds RLS identity and the membership query to the verified-session resolver. Reviewer made no edits and ran no tests.
- Approval remains slice-limited; task stays `in_progress`. H-SELF-002 session provider/policy, H-DB-003 deployment grants/context, consumer migration, Supabase/Auth replacement, and production remain outside this approval.

## Next action

Continue with a separate H-DATA-003 repository slice using PostgreSQL in disposable Docker Desktop. Keep this guard task `in_progress` pending approved verified-session integration and deployment-role grants/context.
