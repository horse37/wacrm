# Task — PostgreSQL pool and migration runner

> Aviso (2026-10-18): todos os "Next action", "Exact next action" e "Latest next action" anteriores ao bloco F1–F5 são checkpoints históricos e estão superados. A próxima ação vigente está no bloco de remediação F1–F5 e nas correções posteriores: nova revisão independente read-only e revisão final; a validação disposable do probe alterado já foi executada (ver seção "Validação das pendências — 2026-10-18").
- id: `20261016-122249401-af84`
- type: migration
- slug: `postgres-pool-migration-runner`
- status: in_progress

## Goal
Add a server-side `pg` pool (usage convention; no automated import guard) and ordered migration runner, then prove the actual WACRM migration chain against disposable Docker PostgreSQL.

## Context
The planning task `20261015-223715475-obxw` is complete as an inventory and reviewed design proposal. PostgreSQL and Docker are the selected target. The current WACRM app still uses Supabase for database access, Auth, RLS, Storage, and Realtime; this task replaces none of those consumers.

## In scope
- Inventory existing SQL migration files and classify Supabase-specific statements before editing.
- Implement a server-side PostgreSQL pool (usage convention; no automated import guard) and explicit, ordered migration runner with durable history, advisory locking, replay safety, and fail-closed error handling.
- Exercise the real WACRM migration chain against an empty disposable Docker PostgreSQL instance.
- Verify rerun, concurrent invocation, failure recovery, runtime/job/migration roles, grants, account isolation assumptions, and restore prerequisites.
- Record exact commands, exit codes, results, warnings, and limitations in task-owned logs.

## Out of scope
- Migrating application query consumers, authentication, Storage, Realtime, routes, or browser bundles.
- Supabase local or remote, VPS, production, homologation, real customer data, or real WhatsApp chips.
- Reusing, stopping, or modifying existing containers or volumes.
- Branch changes, staging, commits, pushes, or deployment.

## Validation
Use only task-owned Docker resources with unique names, `--network none`, temporary storage such as tmpfs, and automatic cleanup. Never attach an existing named volume. Run focused runner tests and the actual SQL chain; record inherited suite failures separately from task failures. Before any implementation edit, report the migration inventory and Supabase-specific SQL classification in the handoff.

## Next action
Inspect the 18 flagged migration files in groups and document test-only prerequisite objects and portability boundaries before source edits.

## Progress — read-only migration inventory (2026-10-16)
- Inventory: 26 SQL files, all in supabase/migrations/001–026; details and per-file marker map are in migration-inventory.md.
- Static scan: 18 files include Supabase-specific markers; 8 have no marker from this scan. Twelve use auth.uid()/auth.jwt(), four depend on Storage objects/helpers, three target supabase_realtime, eleven mention Supabase roles, eleven contain RLS statements, and migration 001 requests uuid-ossp.
- This is source inspection only. SQL was not executed, and no app code, SQL, tests, containers, or volumes were modified.
- Next: read the 18 flagged files in groups and document prerequisite objects/compatibility boundaries before source edits.
## Progress — dependency group 1
- Targeted source inspection: 001, 008, 016, 020, 023. Supabase auth helper and Storage schema/path objects are explicit dependencies; Storage policies encode public-read and per-user/account path rules.
- Static runner scan found no CREATE/DROP INDEX CONCURRENTLY, VACUUM, CREATE DATABASE, or ALTER SYSTEM statements (search exit 1, no matches). This does not prove all statements are transaction-safe.
- Function/privilege scan found 117 matching lines across 11 files, including SECURITY DEFINER and EXECUTE grants; output was truncated. Review migration ownership, search_path, and grants before execution.
- No SQL, tests, Docker, application code, or existing containers/volumes were changed.
## Progress — role/RPC dependencies
- auth.users is referenced by migrations 001, 006, 010, and 017; 001/017 install handle_new_user triggers. Historical SQL therefore needs auth schema/table objects in the test bootstrap.
- Nine functions in migrations 001, 017, 018, 019, and 022 contain OWNER TO postgres; the migration chain must not be run as superuser just to satisfy these clauses.
- No SQL role creation/default-privilege setup was found. Thirty SECURITY DEFINER markers in 11 files require ownership, search_path, and EXECUTE-grant assertions.
- Test-only bootstrap limits and migration identity policy are recorded in compatibility-boundary.md. No source migration was edited yet.
## Progress — Auth/Storage/Realtime screening (2026-10-16)

Completed a targeted, read-only screening pass for migrations `006–013` and a filename-level marker pass for `014–023`. The inventory now distinguishes valid PostgreSQL features such as `SECURITY DEFINER` functions from platform-specific Auth, Storage, and Realtime dependencies. This does not yet prove the migration chain runs under an unprivileged role. No SQL, source code, tests, Docker resources, or package files were changed in this pass.

Exact next action: semantically inspect `014_message_templates_meta_integration.sql`, `015_whatsapp_config_registration.sql`, `016_flow_media.sql`, `020_account_sharing_followups.sql`, `021_account_default_currency.sql`, `022_contact_phone_dedup.sql`, and `023_chat_media.sql`; record their required bootstrap objects and resolve `OWNER TO postgres` behavior before implementation.
## Progress — semantic pass of migrations 014–023 (2026-10-16)

Confirmed that migrations `014`, `015`, and `021` do not reference Auth, Storage, Realtime, function ownership, or grants in executable SQL. Migrations `016`, `020`, and `023` require Auth/Storage compatibility objects in the test database. Migration `022` defines a `SECURITY DEFINER` function owned by `postgres`, pins `search_path` to `public`, and revokes `PUBLIC` execution without an explicit grant in the file. This makes ownership a privilege gate for a least-privilege runner.

Exact next action: prove whether the existing `OWNER TO postgres` clause can run with a non-superuser migration identity on a disposable PostgreSQL container, while preserving the chain unchanged. If safe execution requires superuser, record that as a migration-chain blocker before implementing the runner.
## Progress — non-superuser OWNER probe (2026-10-16)

A Docker PostgreSQL 15 tmpfs probe confirmed direct login as `wacrm_migrator` (`NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`) can execute the representative function owner/revoke sequence while `postgres` is `NOLOGIN NOSUPERUSER`. Missing `USAGE, CREATE` on `public` caused the first attempt to fail; adding explicit grants resolved it. The final SQL command exited 0 and returned `wacrm_migrator|wacrm_migrator|false|postgres|false`. A `REVOKE` warning appeared but the ACL query showed no PUBLIC EXECUTE. This is not an actual migration-chain run.

Superseded (historical checkpoint; completed in later sections). Exact next action at the time: inspect the package manifest and its existing diff, then implement only the isolated server-only `pg` pool and ordered migration runner, keeping the task's test-only compatibility bootstrap separate from application runtime roles. Full-chain validation in disposable Docker PostgreSQL remains required.
## Progress — test-bootstrap contract

Documented the disposable-cluster prerequisites: `uuid-ossp`, pre-created `supabase_realtime` with `wal_level=logical`, minimal Auth and Storage compatibility objects, synthetic roles named by existing GRANT statements, and separate non-superuser migrator/owner roles. These objects remain test-only. The scan found no concurrent index creation or explicit transaction-control statements in the migration files, so per-file transactions are viable pending the full-chain run.

Superseded (historical checkpoint; completed in later sections). Exact next action at the time: add the lazy server-only `pg` pool, ordered/checksummed migration runner, and focused unit coverage; then run the complete 26-file chain in disposable Docker PostgreSQL 15 through a direct non-superuser login.

## Review follow-up — runner and bootstrap (2026-10-16)
- Independent read-only review found the focused tests did not exercise `runMigrations`, and the disposable bootstrap did not state that the historical owner name `postgres` must be distinct from the image's default superuser.
- Added mock-client coverage for ordered application, advisory-lock use, ledger writes, replay skipping, checksum mismatch rejection, rollback, and cleanup. Added an explicit bootstrap preflight and documented initialization with a separate `POSTGRES_USER=bootstrap_admin` in `compatibility-boundary.md`.
- The default runner owner remains `postgres` intentionally because nine historical functions transfer ownership to that role. No migration SQL is changed. Standard PostgreSQL Docker initialization with `POSTGRES_USER=postgres` is not a valid fixture setup; use a disposable cluster initialized with a differently named superuser.
- Validation after these edits (2026-10-16): `npm run test:postgres-migrations` SUCCESS, 8/8; `node --check scripts/migrate-postgres.mjs` and `node --check scripts/migrate-postgres.test.mjs` SUCCESS. `npx prettier --write` completed for those two JavaScript files.
- Docker bootstrap SUCCESS: PostgreSQL 15, `--network none`, `/var/lib/postgresql/data` tmpfs, synthetic `POSTGRES_USER=bootstrap_admin`; bootstrap SQL applied and verified `postgres|false|false`, `wacrm_migrator|false|true`, and publication `supabase_realtime`; disposable container cleanup exit 0. Negative bootstrap probe with standard `POSTGRES_USER=postgres` failed closed with the intended actionable error (psql exit 3); container cleanup exit 0.
- `npm run typecheck` FAILURE in existing app files because installed `next/navigation` types do not export `useRouter`, `useSearchParams`, or `useParams`; no changes were made to those files. Targeted ESLint FAILURE before linting due installed ESLint runtime error `Class extends value #<Object> is not a constructor or null`. Prettier check was run before formatting and failed for formatting warnings plus no SQL parser for the bootstrap file; formatting check was not rerun for the Markdown files. Gitleaks and the full migration chain were not rerun in this validation pass.
- The full task remains in progress pending real Docker checks for concurrent invocations, failure recovery, runtime/job/migration roles and grants, account-isolation assumptions, and restore prerequisites. The earlier full-chain result recorded above remains historical evidence from the prior session, not a rerun here.

## Independent re-review follow-up (2026-10-16)
- The second read-only review found that the first mock did not model stateful `SET ROLE`, and the bootstrap did not reject a database other than `postgres` before DDL. Both findings are addressed: the mock tracks `currentRole`, asserts owner role during migration SQL and verifies `SET ROLE` precedes it; the SQL bootstrap checks `current_database()` first.
- Validation after the second corrections: isolated `node:22-bookworm` container with `--network none` ran `node --test /tmp/migrate-postgres.test.mjs`: SUCCESS 8/8; cleanup exit 0. `npx prettier --check scripts/migrate-postgres.mjs scripts/migrate-postgres.test.mjs`: SUCCESS. Disposable PostgreSQL 15 with `--network none` and tmpfs accepted the `postgres` target database, applied the fixture, and verified owner/migrator role flags and `supabase_realtime`; the same fixture against `otherdb` failed before DDL with the intended error (psql exit 3); both container cleanups exited 0.
- The read-only reviewer confirmed both code corrections by inspection. The reviewer also identified and prompted correction of the stale next-action note in this file; this note now records completed validation.
- Remaining exact next action: execute the real runner concurrently against a disposable PostgreSQL instance and verify one application plus one replay, then record failure recovery, runtime/job/migration grants, account-isolation assertions, and dump/restore prerequisites. The isolated Node test runner currently lacks the `pg` runtime package, and the host has no `pg` install; do not use a networked test container because the task requires network isolation. The earlier full-chain runner result remains historical and does not satisfy these remaining checks.

## PostgreSQL runner validation — final bootstrap grants (2026-10-16)
- Corrected the test-only bootstrap boundary: `CREATE` is revoked from `PUBLIC`; only the `NOLOGIN NOSUPERUSER` `postgres` migration-owner role receives `USAGE, CREATE` on `public`. `wacrm_migrator` has `NOINHERIT`, is not superuser, and enters the owner role only through the runner's `SET ROLE`. The actual login's direct `CREATE TABLE public...` probe returned psql exit 1, `permission denied for schema public` (expected denial).
- Fresh task-owned Docker PostgreSQL 15 cluster used `--network none`, tmpfs data, read-only WACRM bind mount and test bootstrap. Two concurrent runner invocations both exited 0: one applied 26/26 migrations; the other waited and replayed all 26 (`applied=0, skipped=26`).
- `docker exec wacrm-pg-runner-final-20261016 node /opt/wacrm/scripts/failure-recovery.mjs`: SUCCESS, exit 0. Deliberate migration 999 failed; transaction removed its DDL and ledger row; corrected retry applied it once; probe objects were cleaned.
- `docker exec wacrm-pg-runner-final-20261016 node --test /workspace/scripts/migrate-postgres.test.mjs`: SUCCESS, 8/8.
- Role snapshot: migrator LOGIN/NOSUPERUSER, CONNECT=true, public USAGE=true/CREATE=false; owner postgres NOLOGIN/NOSUPERUSER, public USAGE/CREATE=true; anon/authenticated/service_role NOLOGIN/NOSUPERUSER and public CREATE=false. There are no separate WACRM runtime/job database identities or consumers wired yet; this task does not invent them.
- After chain: 26 ledger rows, 31 public RLS tables, 79 public policies and 12 Storage policies, 18 public SECURITY DEFINER functions, one `supabase_realtime` publication. The repeatable SQL `account-isolation-probe.sql` passed in both migrated and restored clusters: `auth.uid()` claim for account A saw two same-account profiles and zero account-B profiles. Probe grants SELECT only inside a rolled-back transaction to model grants supplied outside this historical migration chain. This is SQL-policy evidence using the test shim, not Supabase Auth validation or proof for every table.
- Dump/restore: `pg_dump -Fc -n public -n storage` exited 0. Initial restore exited 1 because fixture precreated `storage.foldername`; retry with `pg_restore --clean --if-exists` exited 0 in a second clean PostgreSQL 15 tmpfs cluster. Restored counts matched 26 ledger rows, 31 public RLS tables, 79 public/12 Storage policies, 18 SECURITY DEFINER functions, one publication and one Storage helper.
- Focused runner tests passed. TypeScript/lint were not rerun; previous global TypeScript failed on `next/navigation` exports, ESLint failed in its installed runtime. Serena diagnostics also lacked host-installed `pg` declarations; its SQL-file diagnostic was not applicable. No independent review was run: user asked to ignore Ruflo, and no local independent review tool was exposed. Manual read-only review found no further issue in this pass.
- Containers `wacrm-pg-runner-final-20261016` and `wacrm-pg-runner-restore-20261016` were stopped and removed by exact names (stop/rm exit 0 each); their data was tmpfs only. Prior task container `wacrm-pg-runner-codex-test-20261016` and its state were left untouched.
- Keep task `in_progress`. Exact next action: define least-privilege runtime and background-job role grants before their consumers are wired, obtain an independent read-only review if available, then run TypeScript/lint in a dependency-complete isolated environment. This evidence does not validate Supabase Auth, Storage, Realtime behavior, production identity, or production restore.

## Runtime/job role boundary follow-up — 2026-10-16
- H-DB-002/H-DB-003 specify separate runtime and elevated-job identities, both without table ownership or `BYPASSRLS`, with a table/operation grant matrix and distinct credentials/pools. Added task-only `wacrm_runtime` and `wacrm_job` roles to the disposable bootstrap with LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, and an explicit database CONNECT grant; effective PUBLIC defaults may grant additional privileges. `role-boundary-probe.sql` confirms they have no membership, CREATE, or table DML privileges both before/after restore.
- Re-ran the full 26-migration chain in fresh PostgreSQL 15 `--network none`/tmpfs Docker cluster after this bootstrap change. Concurrent runner invocations exited 0: one applied all 26; one replayed all 26. Focused tests passed 8/8; recovery probe passed. Direct migrator CREATE denial remained expected.
- Synthetic `profiles` RLS probe passed after migration and after restore: user A saw two same-account profiles and zero profiles in account B. Probe uses the test-only `auth.uid()` shim and a temporary grant in a rolled-back transaction.
- New clean-cluster `pg_dump -Fc -n public -n storage` and `pg_restore --clean --if-exists` both exited 0; restored counts matched (26 ledger rows, 31 public RLS tables, 79 public policies, 12 Storage policies, 18 SECURITY DEFINER functions, one Realtime publication, one Storage helper). Exact artifacts/commands recorded in `validation-pg-runner-final-20261016.log` and task probes.
- Runtime/job roles are deliberately unusable until an approved operation matrix identifies repositories, authentication/account-context contract, and job operations. No broad grants or production credentials added. Existing Supabase consumers remain unchanged.
- Exact next action: obtain independent read-only review when available, then run TypeScript/lint in a complete dependency environment. Keep task `in_progress` until those checks and review are resolved; do not treat synthetic fixture as Supabase or production proof.

## Review corrections — 2026-10-16

- HIGH-1: added forward migration `027_restrict_broadcast_recompute_execute.sql`. It revokes default `PUBLIC` execution from internal SECURITY DEFINER helpers, including `_bcast_bump`, `broadcast_recipient_aggregate_trigger`, and `handle_new_user`; it removes PUBLIC from `is_account_member` while preserving its explicit `authenticated` and `service_role` grants; it reserves `recompute_broadcast_counts` to its owner. Role probe now fails if either placeholder role can execute any public SECURITY DEFINER function and prints the effective ACL inventory.
- HIGH-2: account probe still uses a synthetic `authenticated` role and manual `request.jwt.claim.sub` only for the historical `profiles` RLS policy. It now separately asserts `wacrm_runtime` and `wacrm_job` cannot SELECT profiles. It explicitly does not claim trusted identity or runtime/job account isolation; those roles have no operation grants yet.
- MEDIUM-1/2: saved repeatable Docker workflow at `scripts/testing/validate-postgres-migration-runner.ps1`; all psql calls use `-X -v ON_ERROR_STOP=1`. It uses `--network none`, task-owned containers, tmpfs, temporary cached pg dependency, and cleanup. The lock holder is confirmed active in `pg_stat_activity` before starting the runner contender.
- MEDIUM-3: dump now includes the complete fixture database, including `auth`; restore comparison checks exact sorted manifests for migration checksums, tables, columns/defaults, policy definitions, `auth.users` trigger definitions, and publications. Matching counts alone are no longer the evidence.
- MEDIUM-4: checksums normalize LF/CRLF and accept legacy raw-byte hashes; focused tests cover canonical equality and legacy replay.
- MEDIUM-5: CLI refuses to run without explicit `WACRM_MIGRATION_OWNER_ROLE`; runner validates LOGIN/NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, and NOBYPASSRLS for both login and owner roles.
- LOW lock timeout/unlock and owner/ledger edge cases have focused unit coverage. Lock wait is bounded by `WACRM_MIGRATION_LOCK_TIMEOUT_MS`.

### Validation after corrections

- `node --test --test-reporter=dot scripts/migrate-postgres.test.mjs`: SUCCESS, 16/16 in the isolated Docker runner.
- `scripts/testing/validate-postgres-migration-runner.ps1`: SUCCESS, exit 0. PostgreSQL 15, network none, tmpfs; 27 migrations applied then 27 skipped on replay. Observed lock holder was active before the runner started; contender waited 5.27 seconds. Role probe found 0 callable public SECURITY DEFINER functions for runtime/job. Synthetic RLS probe and role boundary passed before and after restore. Full dump/restore manifest matched, including `auth.users` trigger `on_auth_user_created`.
- `npm run typecheck` initially failed only because TypeScript tried to write the existing build-info path on a read-only source mount. `./node_modules/.bin/tsc --noEmit --tsBuildInfoFile /tmp/wacrm-tsconfig.tsbuildinfo` in Docker: SUCCESS, exit 0.
- `npm run lint` in Docker: SUCCESS, exit 0; 0 errors and 19 existing warnings.
- Offline cached `pg@8.16.3` and full dependency installs were isolated under `%TEMP%`; no package files or `node_modules` in the checkout were changed by validation.
- Gitleaks and a new independent review were NOT EXECUTED. Ruflo remains excluded per the user's earlier direction. Task remains `in_progress` pending independent read-only review and the still-unapproved runtime/job operation grant matrix. No Auth provider or production behavior was validated.

## Final security-scan update — 2026-10-16

- `docker run --rm --network none ... zricethezav/gitleaks:v8.21.2 git . --no-banner --redact`: FAILURE, exit 1, 3 generic-api-key matches. Redacted metadata locates all three in pre-existing untracked `docs/environment-variables.md` (lines 38 and 42; historical commits `be7edfd…` and `7148c20…`). These files were already under `?? docs/` before this continuation and were not edited. No secret values were emitted or changed.
- This is an inherited checkout finding, not a clean Gitleaks result for the whole repository. Task remains in progress; preserve the owner’s pre-existing docs pending review.

### Final post-format validation update — 2026-10-16
- Focused runner tests passed 16/16; Prettier check passed; TypeScript passed with build-info directed to `/tmp`; ESLint passed with 0 errors and 19 warnings.
- Final redacted Gitleaks 8.21.2 scan failed with the same three inherited matches in pre-existing untracked `docs/environment-variables.md`; no finding points to task-owned files. Keep this baseline failure visible.
- Exact next action remains independent read-only review of the task-owned diff; do not stage/commit/push/deploy or change unrelated dirty work.

## Independent review and corrections — 2026-10-17
- Read-only Codex reviewer `/root/wacrm_migration_review2` found MEDIUM: the runner checked role attributes but not memberships that permit `SET ROLE`; and LOW/MEDIUM: migration 027 described `recompute_broadcast_counts` as trigger-internal although migration 005 retains it for operator repair.
- `scripts/migrate-postgres.mjs` now requires the migrator login's only direct membership to be the migration owner and requires the owner to have no role memberships. `scripts/migrate-postgres.test.mjs` adds rejection cases for an extra `service_role` membership on the login and on the owner.
- Migration 027's comment now identifies the function as an on-demand operator repair, not a trigger dependency. `compatibility-boundary.md` records a controlled `SET LOCAL ROLE` repair example, prohibits restoring `service_role` EXECUTE, and keeps the production operator identity/credentials pending H-DB-003.
- The Docker validation harness was corrected to record tests only after they run, tolerate expected psql stderr warnings when exit code is zero, avoid creating an unnecessary invalid package.json, log failures, and safely clean only its unique containers/TEMP path.
- Validation: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-migration-runner.ps1` SUCCESS, exit 0. Docker PostgreSQL 15 `--network none`/tmpfs; focused Node tests 18/18; 27 migrations applied, replay skipped 27, active lock holder observed and contender waited 4.88 s; role and RLS probes passed; dump/restore manifest matched including `auth.users` trigger; task containers removed. See `validation-review-corrections-b25ff25a58.log`.
- Of 11 regular validator logs dated 2026-10-17, four end SUCCESS (`b25ff25a58`, `5ba862d8d8`, `5304f1c576`, `53d280bd3a`), five explicitly fail (`128ae5d514`, `528053ba29`, `77cf91c877`, `9f04beec1e`, `a95df2262d`), and two (`2c72ae72f3`, `39f7d8ec64`) end after focused-test output without an overall result; their termination cause is unknown. Three failure-injection probes are separate (`d6af3a79c3`, `18a39ebebf`, `a12fb2c786`). The `9f04beec1e` log's original cleanup claim is corrected in an appended note; its TEMP folder remains preserved.
- Independent re-review of the exact-path correction and final task-owned documentation is pending. Keep task `in_progress`. H-DB-003 still needs an approved role/operation matrix before runtime/job grants; no Auth/Storage/Realtime replacement is validated. Gitleaks remains an inherited failure: three redacted generic-api-key findings in pre-existing `docs/environment-variables.md`; not rerun after this patch. No full test suite, build, stage, commit, push, or deploy was run here.

## Cleanup LOW correction — 2026-10-17
- Fixed `scripts/testing/validate-postgres-migration-runner.ps1`: Docker inspection/removal for runner and PostgreSQL containers now run in independent guarded attempts; the dependency-folder cleanup always runs afterward. Cleanup errors are accumulated, written to the task log when possible, and reported only after all cleanup attempts finish.
- Tightened the temporary-folder guard: cleanup accepts only the exact `%TEMP%` child matching `wacrm-pg-validation-<10 lowercase hex>`; other paths are preserved and reported.
- PowerShell AST parse: SUCCESS, exit 0.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-migration-runner.ps1`: SUCCESS, exit 0. Focused tests 18/18; PostgreSQL 15 disposable Docker with `--network none` and tmpfs; all 27 migrations applied, replay skipped all 27; active advisory-lock holder observed and contender waited 4.91 seconds; role/RLS probes and dump/restore manifest comparison passed. Log: `validation-review-corrections-5ba862d8d8.log`.
- Cleanup verification: Docker inspection exit 0; neither task container remained; this run's dependency folder was absent. The earlier preserved folder `wacrm-pg-validation-9f04beec1e` was not touched.
- `rtk git diff --check`: SUCCESS, exit 0 for tracked diff. The modified runner and HARNESS records are pre-existing untracked task files, so Git diff checks do not include them; PowerShell parsing and the actual runner execution validate the changed script.
- No Gitleaks, full application suite, build, independent re-review, staging, commit, push, or deployment was run in this step. The task remains `in_progress`; runtime/job table grants still require the approved H-DB-003 operation matrix. Prior Gitleaks failure remains three redacted matches in pre-existing `docs/environment-variables.md`.
- Exact next action: obtain read-only re-review of the exact case-sensitive TEMP path guard and corrected log/probe/TEMP records; require zero findings of every severity. Keep runtime/job grants out of scope until H-DB-003's per-operation policy is approved.

## Re-review findings closed — 2026-10-17
- Finding 1: the runner saves the primary validation exception before cleanup. If recording it fails, that logging failure is appended to the saved diagnostic. If cleanup also fails, the final exception and cleanup log include the primary validation failure plus every cleanup failure; cleanup attempts still run independently.
- Finding 2: `scripts/testing/validate-postgres-migration-runner.ps1` now requires the exact dependency-directory leaf `wacrm-pg-validation-$suffix` with case-sensitive `-cne`, and still requires its parent to equal `%TEMP%`.
- Finding 3: the 11 regular validator runs dated 2026-10-17 are classified as four SUCCESS (`b25ff25a58`, `5ba862d8d8`, `5304f1c576`, `53d280bd3a`), five explicit failures (`128ae5d514`, `528053ba29`, `77cf91c877`, `9f04beec1e`, `a95df2262d`), and two without an overall result (`2c72ae72f3`, `39f7d8ec64`; termination cause unknown). Three failure-injection probes are separate: inline stub probe `d6af3a79c3`, reusable five-assertion probe `18a39ebebf`, and updated six-assertion probe `a12fb2c786`. The first reusable probe and the inline probe were run from separate PowerShell invocations; their logs show localized and English diagnostics respectively. Appended correction to `validation-review-corrections-9f04beec1e.log`: its TEMP directory was preserved, not removed. The additional `%TEMP%\wacrm-pg-validation-23532e00d79f457f9b53b368d00736bc` directory was created 2026-10-16 20:15 and contains `node_modules` with `pg@8.16.3`; it is probably an offline dependency-install artifact for this task, but no log proves the exact invocation. It remains preserved and was not removed.
- PowerShell AST parse: SUCCESS, exit 0.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-migration-runner.ps1`: SUCCESS, exit 0. PostgreSQL 15 disposable Docker (`--network none`, tmpfs); focused tests 18/18; 27 migrations applied and all 27 skipped on replay; active lock holder observed and contender waited 4.91 seconds; role/RLS probes and dump/restore manifest comparison passed. Log: `validation-review-corrections-5304f1c576.log`.
- Cleanup check: both exact-name Docker listings exited 0 and returned no containers; this run's temporary dependency directory is absent; prior `wacrm-pg-validation-9f04beec1e` remains present.
- Task remains `in_progress`. Next action: independent read-only re-review of these three corrections, requiring zero open findings of any severity for approval of this correction scope. H-DB-003 role grants remain unapproved and out of scope. No Gitleaks, full app suite/build, staging, commit, push, or deploy was performed in this step.

## Failure-path probe — 2026-10-17
- Added `.harness/tasks/20261016-122249401-af84/probe-runner-cleanup-failure.ps1` as a reproducible, task-owned regression probe. It stubs Docker startup to fail with exit 71 and both cleanup inspections to fail with exit 72; it asserts that the primary validation failure and both cleanup failures appear in the thrown diagnostic and task log, and that temporary dependencies are still removed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\.harness\tasks\20261016-122249401-af84\probe-runner-cleanup-failure.ps1`: SUCCESS, exit 0; all five assertions in the initial version passed. The probe used an in-process Docker stub and created no Docker resources. Its evidence log is `validation-review-corrections-18a39ebebf.log`. The updated six-assertion run is recorded separately in `validation-review-corrections-a12fb2c786.log`.
- This probe does not simulate an unwritable task log. The catch path preserves the primary message and appends any log-write failure to the thrown diagnostic by inspection.

## Re-review remediation — 2026-10-17
- The independent review's LOW guard finding is addressed by the exact, case-sensitive leaf comparison noted above. The latest validator log, `validation-review-corrections-53d280bd3a.log`, is SUCCESS: focused tests passed, all 27 migrations applied and were skipped on replay, role/RLS and restore-manifest probes passed, and task-owned containers were removed; PostgreSQL used `--network none` and tmpfs.
- Documentation counts and probe provenance are corrected above. The 32-hex TEMP dependency directory remains preserved because its exact originating invocation cannot be proven.
- No new validator or failure probe was run during this documentation correction. The task remains `in_progress`; H-DB-003 is still pending. Next action: independent read-only re-review of the exact guard and corrected records, with approval only if there are zero findings at every severity.


## H-DB-003 — matriz aprovada pelo proprietário — 2026-10-17

Evidência do estado atual:
- Serena `find_referencing_symbols` para `getPostgresPool` retornou vazio; a busca no código encontrou apenas a declaração em `src/lib/db/postgres-pool.ts:47`. A única outra criação de `pg.Pool` está no runner de migração `scripts/migrate-postgres.mjs`.
- Os scripts do package relevantes são `db:migrate` e `test:postgres-migrations`; não há script de worker, job ou cron que use o pool PostgreSQL.
- As validações de fronteira de roles registradas nesta task concedem `CONNECT` explicitamente a `wacrm_runtime` e `wacrm_job`, sem grants explícitos de dados (DML/DDL) para eles e sem `BYPASSRLS`. Defaults de `PUBLIC` (TEMP no banco, `USAGE` em `public`, `EXECUTE` em funções comuns) permanecem efetivos; o probe os reporta, não os nega.

| Papel | Consumidor PostgreSQL ligado hoje | Grants explícitos propostos agora | Estado |
| --- | --- | --- | --- |
| `wacrm_runtime` | Nenhum; pool sem referências consumidoras | Bootstrap concede `CONNECT` diretamente; sem grants explícitos de dados. O probe não afirma defaults herdados de `PUBLIC` | Aprovado pelo proprietário em 2026-10-17: manter sem grants de dados até existirem consumidores |
| `wacrm_job` | Nenhum; sem job/worker/cron PostgreSQL | Bootstrap concede `CONNECT` diretamente; sem grants explícitos de dados. O probe não afirma defaults herdados de `PUBLIC` | Aprovado pelo proprietário em 2026-10-17: manter sem grants de dados até existirem consumidores |

A identidade de migração e o owner usados pelo runner permanecem separados e fora desta matriz. O probe testa privilégios efetivos selecionados, não todos os ACLs: defaults de `PUBLIC` como `USAGE` em `public`, `TEMP` no banco e `EXECUTE` em funções comuns não são afirmados nem negados. Quando uma task ligar consumidor real, especificar método/operação, tabelas e contexto de conta antes de propor grants.

Políticas da migration 017 não especificam `TO`, então aplicam-se a `PUBLIC` e chamam `public.is_account_member`. A migration 027 revoga `EXECUTE` de `PUBLIC` e `anon` para `is_account_member`, então concede-o explicitamente a `authenticated` e `service_role`. O probe concede `SELECT` temporário em `public.contacts` a `anon` dentro de transação revertida e confirma negação em `is_account_member`; qualquer papel futuro com acesso a tabelas cujas policies chamem este helper precisa também de `EXECUTE` explícito, ou de policies apropriadas ao papel.

Decisão do proprietário registrada em 2026-10-17: manter runtime/job sem grants explícitos de dados; o bootstrap concede CONNECT e defaults PUBLIC permanecem efetivos até uma task definir consumidores e operações concretas. Nenhum grant de dados foi aplicado nesta etapa.
Próximo passo: solicitar revisão independente somente leitura da implementação e das evidências finais; considerar esta task aprovada apenas se não houver achados abertos de nenhuma severidade.

## Remediação dos três achados LOW — 2026-10-17

- Pool: removido `import 'server-only'` e documentado como convenção de uso sem guarda automática de imports cliente/servidor, com comentário explícito para não importar em componentes cliente. Não foi mantida dependência `server-only` em `package.json`/lockfile. Criado `src/lib/db/postgres-pool.test.ts`, cobrindo `DATABASE_URL`, valores inválidos dos três limites numéricos, defaults, configuração customizada, singleton e log sanitizado do erro de cliente ocioso.
- Matriz H-DB-003: task e handoff agora dizem que o bootstrap concede `CONNECT` diretamente e não concede privilégios explícitos de dados a runtime/job. Registram que o probe checa privilégios efetivos selecionados, não todos os ACLs ou defaults de `PUBLIC`; `USAGE` em `public`, `TEMP` e `EXECUTE` em funções comuns não são afirmados nem negados.
- Migration 027: `role-boundary-probe.sql` concede `SELECT` temporário em `public.contacts` a `anon`, testa a policy da migration 017 e exige negação especificamente em `is_account_member`; a transação termina em `ROLLBACK`. A matriz e a fronteira de compatibilidade agora exigem `EXECUTE` explícito do helper para qualquer papel futuro com acesso a tabelas cujas policies o chamem, ou policies scoped ao papel.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-migration-runner.ps1`: SUCCESS, exit 0. Log `validation-review-corrections-15d82b7324.log`: 27 migrations aplicadas, replay pulou 27; contender de lock esperou 4,9 s; probes runtime/job, anon e RLS passaram; restore comparou manifest completo; containers task-owned removidos, PostgreSQL em tmpfs e sem rede.
- `node --test %TEMP%\wacrm-pool-review-20261017\verify-postgres-pool.test.mjs`: SUCCESS, exit 0, 4/4. Harness temporário transpila o módulo TypeScript com o TypeScript do projeto e injeta `pg.Pool` mockado; foi preservado em `%TEMP%`.
- `npx prettier --check src/lib/db/postgres-pool.ts src/lib/db/postgres-pool.test.ts`: SUCCESS, exit 0.
- `npx tsc --noEmit`: FAILURE, exit 1, 30 erros no repositório; zero referências aos dois arquivos do pool. Não classificar os erros restantes como baseline sem revisão individual.
- `npx eslint src/lib/db/postgres-pool.ts src/lib/db/postgres-pool.test.ts`: FAILURE, exit 2 antes de analisar arquivos (`Class extends value #<Object> is not a constructor or null`).
- `npx vitest run src/lib/db/postgres-pool.test.ts --reporter=dot`: FAILURE antes da coleta por binding nativo Rolldown inválido/ausente. Tentativas equivalentes em container Linux descartável também não carregaram binding opcional; logs preservados em `%TEMP%\wacrm-pool-review-20261017`. O harness Node 4/4 acima valida o comportamento do módulo, mas a execução pelo Vitest permanece pendente.
- Não houve Gitleaks, build da aplicação, suíte completa, stage, commit, push ou deploy. A falha Gitleaks histórica herdada permanece sem nova execução.
- Próxima ação única: revisão independente read-only das três correções, do probe, do teste e destes registros. Exigir zero achados abertos em qualquer severidade; até lá, task `in_progress`.

## Re-review follow-up — 2026-10-17

- A revisão independente inicial confirmou as três correções LOW anteriores e identificou uma falha nova no isolamento de ambiente de `src/lib/db/postgres-pool.test.ts`: variáveis `PG_*` do host podiam contaminar o caso de defaults.
- `beforeEach` agora define `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS` e `PG_CONNECTION_TIMEOUT_MS` como strings vazias depois de `vi.unstubAllEnvs()`. Casos específicos continuam sobrescrevendo os valores. Re-review independente confirmou a correção e não encontrou novo achado no trecho alterado. Resultado incremental combinado: zero achados abertos nas quatro remediações; isso não aprova a task inteira.
- `rtk npx prettier --check src/lib/db/postgres-pool.test.ts`: SUCCESS, exit 0.
- `rtk npx vitest run src/lib/db/postgres-pool.test.ts` com `PG_POOL_MAX=4`, `PG_IDLE_TIMEOUT_MS=12000` e `PG_CONNECTION_TIMEOUT_MS=2500`: FAILURE, exit 1 antes da coleta; binding nativo Rolldown Windows inválido/ausente.
- Invocação Docker descartável `node:22-bookworm` (`--rm`, rede bridge, `/tmp` tmpfs e checkout em bind mount read-only) executando `npm ci --no-audit --no-fund`: FAILURE, exit 1. A saída npm informou erro 126 no lifecycle child `napi-postinstall unrs-resolver 1.11.1 check` (`Permission denied`); não foi capturado exit separado do `npm ci` interno.
- Invocação Docker no mesmo formato executando `npm ci --ignore-scripts --no-audit --no-fund`: SUCCESS foi impresso pelo script interno; depois `npx vitest run src/lib/db/postgres-pool.test.ts --reporter=dot` imprimiu `sh: 1: vitest: Permission denied`. A invocação Docker externa terminou FAILURE, exit 1; o exit interno do shim não foi capturado separadamente.
- Invocação Docker executando `node ./node_modules/vitest/vitest.mjs run src/lib/db/postgres-pool.test.ts --reporter=dot` sem configuração do projeto: FAILURE, exit 1. A saída diagnóstica foi condensada pela ferramenta; não atribuir causa. Nenhum teste Vitest passou nesta rodada. Os outputs não foram salvos em arquivo separado.
- Ruflo MCP foi exposto e usado para criar swarm `swarm-1792273564933-ran6jo`, task `task-1792273588001-079a9p` e agente `agent-1792273634094-ykfth0`; a execução do agente falhou porque não há provedor LLM configurado. O agente Ruflo e o swarm foram terminados. Re-review feita por subagente Codex real, sem alterações ou testes pelo revisor.
- Próxima ação: resolver o bloqueio do runner descartável (postinstall/shim/binding nativo) sem alterar `node_modules` do host e executar o teste focado; depois completar validações exigidas e registrar os resultados. Task segue `in_progress`; Gitleaks, build, suíte completa e validação Vitest permanecem pendentes.
- Final runner correction — `--tmpfs /tmp:rw,exec,nosuid,nodev,size=4g`: Docker `node:22-bookworm`, checkout read-only, fresh `npm ci --no-audit --no-fund`; focused pool test with `PG_POOL_MAX=4`, `PG_IDLE_TIMEOUT_MS=12000`, `PG_CONNECTION_TIMEOUT_MS=2500` passed 13/13, 0 failed. Command `npx vitest run src/lib/db/postgres-pool.test.ts --reporter=json --outputFile=/tmp/vitest-result.json`; JSON summary `success=true,total=13,passed=13,failed=0`. Docker invocation exit 0, container `--rm`; host `node_modules`, package files and lockfile unchanged.
- Gitleaks 8.21.2, checkout read-only, Docker `--network none`: FAILURE, exit 1, three redacted `generic-api-key` findings in Git history: `docs/environment-variables.md:38` at `be7edfd180b19936ca109eb69cd312eb527ed704`, and lines 38/42 at `7148c209a0ea3cca39d9933ad1d89e549036317f`. Values remain redacted. These are historical; this session did not edit or ignore them.
- Latest next action: complete remaining required validations and resolve the three historical Gitleaks findings without accepting approval with open findings. Task remains `in_progress`; build and full suite were not run in this session.

## Validation checkpoint — 2026-10-17

- `npm run test:postgres-migrations`: SUCCESS, exit 0, 18/18 tests.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-migration-runner.ps1`: SUCCESS, exit 0. Log: `validation-review-corrections-838f40dcb7.log`. Disposable PostgreSQL 15 applied 27 migrations, replay skipped 27, advisory-lock contender waited 4.9 seconds, selected runtime/job privilege and anon-denial probes passed; that historical log predates the PUBLIC-default wording correction, and dump/restore manifest matched. Task-owned resources were removed; pre-existing containers/volumes were preserved.
- `npm run typecheck` on the host: FAILURE, exit 1, with Next navigation export errors across existing app pages; no diagnostic was reported for `src/lib/db/postgres-pool.ts` or its test. Reconciliation (2026-10-18): the Linux container run without `.next` and with fresh `node_modules` returned exit 0 (`validation-pool-verify-20261018.log`). The host failure is therefore attributed, as a hypothesis not isolated here, to host-local state (stale `.next` types and the broken host `node_modules`), not to repo code.
- `npm run lint` on the host: FAILURE, exit 1, before linting; installed ESLint 9.39.4 threw `Class extends value #<Object> is not a constructor or null` while loading its own dependency. Reconciliation (2026-10-18): the Linux container run with fresh `node_modules` returned lint exit 0 (0 errors, 19 warnings); the host failure is attributed, as a hypothesis not isolated here, to host-local `node_modules`.
- A disposable Docker attempt to run typecheck, lint, full Vitest suite, and build was stopped before `npm ci`: copying the host npm cache into tmpfs exceeded the useful runtime. The owned container was removed; no test suite or build ran there. Record as BLOCKED, exit 137; not a test result.
- Gitleaks was not rerun. The prior FAILURE remains three redacted `generic-api-key` findings in historical `docs/environment-variables.md`: commit `be7edfd180b19936ca109eb69cd312eb527ed704` line 38; commit `7148c209a0ea3cca39d9933ad1d89e549036317f` lines 38 and 42. That file is absent at current HEAD. No value was displayed, ignored, or rotated. These findings are not classified as false positives; task closure is blocked pending a decision on safe credential rotation and historical secret removal.
- Serena was activated for WACRM; `getPostgresPool` and references were queried, and diagnostics for pool source/test returned `{}`.
- Ruflo MCP swarm `swarm-1792278074696-h522nz`, task `task-1792278091839-jt2726`, agent `agent-1792278084693-vvh68y`: agent execution FAILURE because no LLM provider is configured. No independent conclusion was attributed to it.
- Task remains `in_progress`; no code, stage, commit, push, deploy, branch switch, or history rewrite occurred.

### Exact next action (superseded by the 2026-10-18 F1–F5 remediation; the owner decision recorded below is resolved)

Obtain the owner's decision on rotating the potentially exposed `META_APP_SECRET` and `ENCRYPTION_KEY` in any environment that uses them, and on authorizing a coordinated local Git-history rewrite. Until that decision and safe key/data-impact analysis are complete, do not suppress Gitleaks findings or declare the task approved.
## Independent-review gate — 2026-10-18

The read-only review requested for the checkpoint above did not run: the reviewer role's configured model was unsupported by this Codex account; a second independent agent attempt then returned the account usage-limit error. No review verdict exists for this checkpoint. The earlier zero-finding review predates these appended records. Keep task `in_progress` and require a real independent read-only review before claiming the whole task approved. The pending owner decision on safe key rotation and local history cleanup remains open.
## Update — local historical Gitleaks findings (2026-10-18)
Owner confirmed the historical `META_APP_SECRET` and `ENCRYPTION_KEY` examples were synthetic and authorized local history cleanup after backup. No rotation or push was authorized.

Backup `D:\Sistemas\TRAE IA\zapcrm\wacrm-backup-20261018-filter` exists; the full-history bundle passed verification in this session. The previous full checkout comparison had zero differences. A fresh mirror was filtered with git-filter-repo 2.47.0, replacing the two exact synthetic values associated with three reported findings. Only `refs/heads/main` and `refs/remotes/origin/main` were rewritten. The custom Codex checkpoint remains unchanged: it points to a tree, and that tree does not contain `docs/environment-variables.md`. Local `main` and `origin/main` now resolve to `029d4b42dc06999044d72c6c234c68e85b8798e7`; `origin/HEAD` remains symbolic.

Validation: Gitleaks 8.21.2 in Docker with `--network none` and read-only checkout passed twice after rewrite (once before and once after pruning): exit 0, 232 commits scanned, no leaks. `git reflog expire --expire=now --all` exit 0; `git gc --prune=now` exit 0; the two finding commits and old HEAD (three objects total) are absent; `git fsck --unreachable` reported 0. HEAD tree and the 141 pre-existing dirty status entries are unchanged. No functional tests run; earlier tests remain historical evidence. No stage, commit, or push. The remote server was not updated and may reintroduce the old history on a future fetch.

The local history rewrite is approved within scope after independent read-only review, with zero findings on the wording corrections. The reviewer verified the count: two finding commits plus old HEAD, three objects total. No raw Gitleaks logs were found; Gitleaks results remain executor-recorded evidence, not independently rerun in review. This limited approval does not approve the PostgreSQL migration task, production, or migration of WACRM services. Task stays `in_progress`. Next action: independent read-only review of the previously implemented pool boundary/test, H-DB-003 privilege probe, migration 027 behavior, and validation records. This supersedes earlier next-action notes requesting owner authorization for rotation/history cleanup.

## Review remediation — 2026-10-18
- F1: corrected the pool comment and task records. The pool is server-side by usage convention; no package-level guard or automated client-import boundary is installed. `DATABASE_URL` must remain server-only and must not use a `NEXT_PUBLIC_*` name. Serena found `getPostgresPool` referenced only by its tests; no production consumer exists yet.
- F2: changed the probe and records to describe selected effective privileges, not an effective `CONNECT`-only ACL. The probe now requires the disposable fixture superuser, checks membership, CREATE, table/column DML and table-control privileges, sequences, SECURITY DEFINER access, and reports effective PUBLIC defaults including TEMP, schema USAGE, and ordinary-function EXECUTE. It does not claim defaults are absent.
- F3/F4: migration 027 now revokes direct EXECUTE on trigger/recompute helpers from PUBLIC and named API roles; it revokes PUBLIC/anon from `is_account_member`, then grants authenticated/service_role. The probe asserts the effective function ACL matrix and exercises the auth and broadcast trigger paths after revocation in a rollback-only synthetic transaction.
- F5: marked the old current-task next action as superseded, restored the Restrictions heading, and aligned current status with this review/remediation cycle.
- First two disposable probe iterations failed and were retained: `validation-review-corrections-7e4181c1db.log` (missing synthetic contact account_id) and `validation-review-corrections-e7a7209537.log` (the fixture's broadcast_recipients has no account_id). The probe was corrected to follow migrations 001/017; no persistent database was used.
- Final validation: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\testing\\validate-postgres-migration-runner.ps1` wrapped to capture exit; SUCCESS, exit 0, log `validation-review-corrections-3da342c218.log`. PostgreSQL 15 disposable Docker, `--network none`, tmpfs: 27 migrations applied, 27 replay-skipped; lock contender waited 4.89 seconds; selected ACL and anon-denial probes passed; auth and broadcast triggers fired after direct EXECUTE revokes; restore manifest matched; task-owned containers removed.
- Gitleaks 8.21.2: `git . --no-banner --redact` in read-only Docker with `--network none`; SUCCESS, exit 0, 232 commits, no leaks. Resumo registrado pelo executor em `validation-gitleaks-history-20261018.log`; saída bruta do Gitleaks não preservada.
- No TypeScript, ESLint, application build, or pool Vitest rerun. The pool test's earlier 13/13 result remains executor-recorded history; no JSON/log artifact was preserved. Superseded: `validation-pool-verify-20261018.log` now preserves a 13/13 run. The pool comment only changed in this remediation.
- Task remains `in_progress` and unapproved. Next action: independent read-only re-review of F1–F5 remediation and current records; no stage, commit, or push.
## Validação das pendências — 2026-10-18

- Docker Desktop usado sem tocar containers ou volumes existentes da outra sessão. Recursos da task usam nomes próprios, `--rm`, tmpfs e sem volumes; nenhum resíduo `wacrm-migration-*` ou `wacrm-verify-*` ficou.
- `scripts/testing/validate-postgres-migration-runner.ps1` (PostgreSQL 15 descartável, `--network none`): exit 0. Log `validation-review-corrections-0114ef446c.log`. Cadeia aplicada (27 migrations, replay skipped=27), lock contender, role-boundary probe no banco `postgres` (a saída no `restore_check` não está neste log; ver `validation-review-corrections-982cb9c95e.log`), function ACL matrix, anon denial, triggers e comparação de manifesto do restore com dump de auth/public/storage/publications.
- Container Linux `node:22-bookworm` com cópia do repo e `npm ci --ignore-scripts` (rede bridge para o registro npm): `npm run typecheck` exit 0; `npm run lint` exit 0 com 0 erros e 19 avisos; `npx vitest run src/lib/db/postgres-pool.test.ts` 13/13 exit 0. Log `validation-pool-verify-20261018.log`.
- `scripts/migrate-postgres.test.mjs` foi executado pelo validador e passou. `node_modules` do host não foi usado nem alterado (binding nativo Windows quebrado, registrado antes).
- Não rodado nesta rodada: suíte completa, build da aplicação, Gitleaks sobre a árvore de trabalho (o scan anterior cobre só histórico de commits).
- Atribuição de `package.json` (`git diff`, 6 inserções): da task, `pg ^8.16.3`, `@types/pg ^8.23.1`, `test:postgres-migrations` e `db:migrate`; fora da task, `zap-lead:heartbeat-scheduler` e `test:zap-lead:heartbeat-scheduler`, que pertencem a outro trabalho do Zap Lead e não foram alterados aqui. `package-lock.json` (160 inserções, por diferença do total de 166 e das 6 de `package.json`; não particionado linha a linha) contém as entradas `pg*` da task e provavelmente mudanças de outro trabalho; a separação completa do lockfile fica pendente.
- Rodada final do validador após as correções da revisão (M1–M3, L1–L4): exit 0, log `validation-review-corrections-982cb9c95e.log`. Nele, a saída do probe `role-boundary-probe.sql` e do `account-isolation-probe.sql` no `restore_check` foi gravada. O NOTICE informa o banco e se o check de datacl foi aplicado ou pulado (`restore_check` pula, com aviso explícito). O check de dono emite NOTICE apenas quando é pulado. Os logs anteriores (`0114ef446c`) permanecem como histórico.

## Fechamento de pendências — 2026-10-18

- Gitleaks 8.21.2 na árvore de trabalho (cópia sem `node_modules`, `.next` e `.git`, container `--network none`, somente leitura): exit 0, sem vazamentos. Log `validation-gitleaks-worktree-20261018.log`. Histórico de commits já estava limpo (232 commits) na rodada anterior.
- Suíte completa (`npm test`, container `node:22-bookworm`, `npm ci --ignore-scripts`): exit 0; 53 arquivos e 554 testes passaram. Resultado histórico do estado de trabalho com código do Zap Lead e heartbeat presentes; não é validação isolada do escopo reduzido. Log `validation-full-suite-build-20261018.log`.
- Build de produção (`npm run build`) sem variáveis: exit 1 no prerender de `/forgot-password` (`@supabase/ssr: Your project's URL and API key are required`). Falha de ambiente, não de compilação.
- Build com placeholders sintéticos (`https://synthetic.example.invalid`, chaves fictícias, `ENCRYPTION_KEY` de zeros): `Compiled successfully`, exit 0. Log `validation-build-synthetic-env-20261018.log`. Prova só de compilação; não prova configuração real.
- Lockfile: as 160 inserções de `package-lock.json` são todas da stack `pg` desta task (`pg`, `@types/pg`, `pg-*`, `postgres-*`, `pgpass`, `split2`, `xtend`); nenhuma linha removida. Pendência de lockfile fechada.
- `package.json`: 4 linhas da task; 2 linhas do heartbeat do Zap Lead (`zap-lead:heartbeat-scheduler` e `test:zap-lead:heartbeat-scheduler`) não são desta task. Não removidas aqui; decisão de escopo de commit cabe ao dono.
- Não fechado por esta task (depende de decisão ou trabalho fora do escopo): aprovação do plano de grants H-DB-003 (runtime/job sem grant de dados até decisão do dono), substituição do Supabase Auth/SDK no WACRM, validação contra Supabase real, hipótese de `anon` no Supabase real, e a separação do `package.json` antes de um commit.
- Lint (`npm run lint`, container Linux): 0 erros e 19 avisos, todos de código existente (`no-unused-vars` e `<img>`) em arquivos fora do pool e do runner; não tratados nesta task.
- Escopo da prova de banco: os probes rodaram em PostgreSQL descartável com schema `auth` sintético; não valida Supabase real, a hipótese de `anon` no Supabase real, o plano H-DB-003 nem a substituição do Supabase Auth/SDK.
- Gitleaks da árvore: o scan terminou antes da gravação dos registros finais de `task.md` e de alguns logs; repetir o scan antes de qualquer commit.

## Fechamento final das ressalvas — 2026-10-18

- Validador disposable repetido com captura do exit code no próprio log (`validation-review-corrections-a0a052c5fd.log`): exit 0. Linha "Validator process exit code" gravada ao fim do log. 27 migrations aplicadas e replay `skipped=27`; NOTICE de sucesso do probe no `postgres` e no `restore_check`; probe de isolamento de contas passou; nenhum container residual.
- Ressalva do exit code do validador: fechada por esta rodada.
- Gitleaks da árvore repetido após a última gravação de registros (log `validation-gitleaks-worktree-final-20261018.log`). Escopo verificado depois do scan por comparação de mtime com o início do scan; os únicos arquivos gravados depois são os do próprio scan.
- Não fechado por decisão de escopo, não por falta de execução: H-DB-003 (grants de dados para runtime e job, decisão do dono); substituição do Supabase Auth/SDK no WACRM (trabalho de outra task); validação contra Supabase real e a hipótese de `anon` (exige ambiente Supabase, fora de escopo sintético); separação do bloco do heartbeat em `package.json` (decisão de commit do dono); 19 avisos de lint em arquivos fora do pool e do runner (não tocados por escopo).

## Escopo reduzido para aprovação — 2026-10-18 (decisão do dono)

Escopo aprovável desta task: pool PostgreSQL server-side e runner ordenado de migrations. Evidência por parte:
- Pool: `getPostgresPool()` real conectado como `wacrm_runtime` em PostgreSQL descartável (`scripts/testing/pool-runtime-integration.mjs`, rodado por `validate-pool-and-runner.ps1`): usuário, `application_name=wacrm-web`, SELECT ok e CREATE TABLE negado (42501). Os testes unitários de `postgres-pool.test.ts` continuam usando `pg` mockado.
- Runner: `runMigrations()` sobre uma fixture sintética isolada (`scripts/testing/runner-fixture-integration.mjs`): aplicação, replay idempotente, recusa de lacuna no ledger, rollback de migration que falha, correção aplicada uma vez, recusa de checksum alterado. Isso prova o comportamento do runner nessa fixture; NÃO prova a cadeia commitada de migrations do aplicativo.
- Cadeia histórica: `validate-postgres-migration-runner.ps1` aplicou as 27 migrations em `supabase/migrations` (incluindo 024–026, fora do escopo reduzido) e registrou replay e restore. Essa evidência é histórica do estado de trabalho, não prova de uma cadeia commitada futura.

Dentro do escopo (arquivos):
- `src/lib/db/postgres-pool.ts` e `src/lib/db/postgres-pool.test.ts`
- `scripts/migrate-postgres.mjs` e `scripts/migrate-postgres.test.mjs`
- `scripts/testing/postgres-migration-bootstrap.sql`, `scripts/testing/validate-postgres-migration-runner.ps1`, `scripts/testing/verify-postgres-restore.sql` (manifesto de restore: ledger, tabelas, colunas/defaults, policies RLS, trigger de `auth.users` e publicações; não cobre ACL de função nem owner)
- `scripts/testing/pool-runtime-integration.mjs`, `scripts/testing/runner-fixture-integration.mjs` e `scripts/testing/validate-pool-and-runner.ps1` (provas novas desta rodada)
- `scripts/migrate-postgres.mjs` (regex de versão: três a nove dígitos) e seus testes em `scripts/migrate-postgres.test.mjs`
- `.harness/tasks/20261016-122249401-af84/` (probes, logs e registros da task)
- `supabase/migrations/027_restrict_broadcast_recompute_execute.sql` (migration da cadeia, provada pelo validador)
- as duas dependências `pg` e `@types/pg` e os scripts `test:postgres-migrations` e `db:migrate` em `package.json`, com o lockfile correspondente (160 inserções, 0 remoções)

Fora do escopo (não aprovado nesta task, fica como pendência própria):
- H-DB-003: grants de dados para `wacrm_runtime` e `wacrm_job` (decisão do dono; hoje sem grant de dados)
- Substituição do Supabase Auth e do SDK de dados no WACRM
- Validação contra Supabase real e a hipótese de privilégio de `anon` nesse ambiente
- Scripts `zap-lead:heartbeat-scheduler` e `test:zap-lead:heartbeat-scheduler` em `package.json` (outro trabalho do Zap Lead; não entram no commit desta task)
- Avisos de lint em arquivos fora do escopo (19 avisos, nenhum nos arquivos acima)

Evidência do escopo reduzido: validador da cadeia em estado de trabalho, histórico e não prova uma cadeia commitada futura (`validation-review-corrections-a513f94d6d.log`); typecheck, lint e Vitest do pool (`validation-pool-verify-20261018.log`); suíte completa 554/554, histórica no estado com código do Zap Lead e heartbeat e não isolada para este escopo (`validation-full-suite-build-20261018.log`). O resultado do Gitleaks pós-correções finais está em `validation-post-review-gitleaks-docker-final2-20261018.log`; a tentativa no host (`validation-post-review-gitleaks-20261018.log`) falhou antes do scan porque `gitleaks` não está no PATH. O `final3` anterior não cobre as alterações finais.

## Correções das seis ressalvas do escopo reduzido — 2026-10-18

Escopo mantido: pool e runner. H-DB-003 consta como decidido pelo proprietário em 2026-10-17 (matriz: runtime e job sem grants de dados até existirem consumidores). Substituição do Supabase, Supabase real e a hipótese de `anon` nesse ambiente seguem fora do escopo.

1. Prova do pool (MEDIUM). A integração descartável usa `getPostgresPool()` real como `wacrm_runtime` (PostgreSQL 15, `--network none`, Node 22) e verificou usuário, `application_name=wacrm-web`, SELECT e CREATE TABLE negado (42501). O log histórico `validation-pool-and-runner-d302b7113d.log` antecede as edições finais desta re-revisão; a prova repetida após elas fica em `validation-post-review-pool-runner-final2-20261018.log`. Tentativas anteriores, históricas e não usadas para sustentar o SUCCESS: `validation-pool-and-runner-7c97dd25fd.log` termina com erro de Node sem causa comprovada no log; `validation-pool-and-runner-e3c6da71c7.log` falha na asserção `failing migration aborts the run` porque o ledger tem gap antes da versão 1000; `validation-pool-and-runner-5732a8b7c3.log` falha com permission denied em `wacrm_schema_migrations`; `validation-pool-runtime-8f0fce908d.log` contém a falha de rede `all predefined address pools have been fully subnetted`; `validation-pool-runtime-9225924679.log` é SUCCESS do script antigo; `validation-pool-runtime-fdd45404d7.log` não preserva a saída Node. O script antigo `validate-pool-runtime.ps1` foi substituído por `validate-pool-and-runner.ps1`. Os testes unitários de pool continuam com `pg` mockado.
2. Cadeia validada versus commitada (MEDIUM). A cadeia de 27 migrations em `supabase/migrations`, incluindo 024–026, foi revalidada após a mudança no runner: `validation-review-corrections-a513f94d6d.log`, exit 0, `applied=0, skipped=27`, restore igual, probes nos dois bancos. Isso é histórico do estado de trabalho e não prova uma cadeia commitada futura. Para o runner, a prova é separada: `scripts/testing/runner-fixture-integration.mjs` aplica, faz replay, recusa lacuna no ledger, reverte migration que falha, aplica a correção uma vez e recusa checksum alterado, sobre fixture sintética isolada. Log `validation-pool-and-runner-d302b7113d.log`: exit 0. Essa fixture não é a cadeia do aplicativo.
3. `verify-postgres-restore.sql` (LOW). Incluído na lista. Confirmado: emite manifesto de ledger, tabelas, colunas/defaults, policies RLS, trigger de `auth.users` e publicações. Não cobre ACL de função nem owner; as afirmações de restore nos registros se limitam a esses itens.
4. Referência de Gitleaks (LOW). O scan pós-correções finais, executado com a imagem Docker local `zricethezav/gitleaks:v8.21.2`, está registrado em `validation-post-review-gitleaks-docker-final2-20261018.log`; a tentativa no host está registrada separadamente e não iniciou. `validation-gitleaks-worktree-final3-20261018.log` é anterior às edições finais.
5. Suíte 554/554 (LOW). Qualificada como histórica (ver lista de escopo). O resultado antigo do runner 20/20 antecede a correção da asserção vazia; o resultado anterior do pool 13/13 e o typecheck/lint também são evidência histórica. A revalidação posterior à correção está em `validation-post-review-units-20261018.log`.
6. Regex de versão (LOW). `scripts/migrate-postgres.mjs` aceita de três a nove dígitos (antes, só três). Nenhum documento do projeto impõe três dígitos; o teste antigo só codificava o regex. Testes novos: 1000_future aceito e ordenado após 999; 0001 duplicando 001 rejeitado; nomes inválidos (1_, 01_, 0001name, prefixo de 10 dígitos) rejeitados. Os 20/20 acima incluem esses casos.

Validações anteriores à correção da asserção vazia: `validate-postgres-migration-runner.ps1` exit 0 (`validation-review-corrections-a513f94d6d.log`); `validate-pool-and-runner.ps1` exit 0 (`validation-pool-and-runner-d302b7113d.log`); units, pool Vitest, typecheck e lint exit 0 (`validation-runner-units-typecheck-lint-202610181602.log`). Essas são evidências históricas para a versão anterior do teste.

### Revalidação após correções desta re-revisão (2026-10-18)

O teste unitário corrigido foi executado após a edição da asserção e está registrado em `validation-post-review-units-20261018.log`; depois disso houve somente atualizações documentais nos nomes dos artefatos. A validação descartável de pool/runner e Gitleaks foram executados após congelar essas atualizações finais e estão em `validation-post-review-pool-runner-final2-20261018.log` e `validation-post-review-gitleaks-docker-final2-20261018.log`. Este registro não amplia o escopo para a cadeia commitada de migrations, H-DB-003, Supabase ou produção.

Itens ainda não provados: Supabase real, substituição do Supabase Auth e do SDK de dados, a hipótese de `anon` em Supabase real, e a separação de `package.json` antes do commit (scripts do heartbeat, fora do escopo).

## Revisão interna GPT-6 Luna — ordem do advisory lock (2026-10-18)
- A revisão somente leitura do revisor Codex `/root/review_pool_runner_luna` encontrou um LOW em `scripts/migrate-postgres.test.mjs`: a comparação de `indexOf(lock) < indexOf(BEGIN)` aceitava `-1` quando a chamada do lock estava ausente.
- Correção mínima aplicada: guardar os índices do lock e de `BEGIN`, exigir ambos `>= 0` e então verificar `lockCallIndex < beginIndex`.
- `npm run test:postgres-migrations`: SUCCESS, exit 0, 20/20; log `validation-post-review-luna-lock-order-20261018-2015.log`.
- A re-revisão interna após essa correção ainda está pendente. A task permanece `in_progress`, sem aprovação; não houve stage, commit ou push.

### Resultado da re-revisão interna GPT-6 Luna — 2026-10-18
- Veredito: APPROVE, zero achados e zero ressalvas no escopo pool PostgreSQL e runner.
- Revisor read-only: Codex `/root/review_pool_runner_luna`; conferiu a asserção corrigida, os quatro itens do parecer externo e os registros/validação atualizados. O revisor não executou testes nem alterou arquivos.
- O resultado não aprova a task WACRM inteira nem amplia evidência para H-DB-003, Supabase real, Auth, Storage, Realtime, tráfego ou produção.
- Próxima ação: solicitar revisão independente Claude somente leitura sobre o mesmo escopo reduzido e as evidências listadas; task segue `in_progress` até esse review e os gates restantes.
