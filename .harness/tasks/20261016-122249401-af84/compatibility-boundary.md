# Test compatibility boundary — 2026-10-16

## Purpose
Let a disposable PostgreSQL instance execute the unchanged historical WACRM SQL chain so the runner can be tested. This test bootstrap is infrastructure scaffolding only; it does not provide or validate Supabase Auth, Storage, or Realtime behavior.

## Objects required only by the historical migration SQL
- Roles: anon, authenticated, service_role, and the task's dedicated migration identity.
- Auth schema: a minimal auth.users table sufficient for legacy foreign keys and the handle_new_user trigger; an auth.uid() function reading a transaction-local test identity setting.
- Storage schema: minimal buckets/objects metadata tables and foldername(name) helper sufficient to create historical policies. No object bytes, signed URLs, Storage API, or authorization behavior are simulated.
- Realtime: an owned publication named supabase_realtime for historical ALTER PUBLICATION statements. No websocket/event service is provided.
- Extension uuid-ossp requested by migration 001.

Create these objects only in a uniquely named disposable PostgreSQL service/database, on a task-owned network with no external network, temporary storage, and automatic cleanup. Do not mount any existing volume. Keep the compatibility SQL and logs inside this task.

## Migration ownership
- The runner intentionally targets the non-login, non-superuser role named `postgres`: historical migrations contain `OWNER TO postgres`. Start each disposable official PostgreSQL image with a separate superuser account such as `POSTGRES_USER=bootstrap_admin`; do not use the image default `POSTGRES_USER=postgres`, because that makes the built-in role a superuser and conflicts with the required owner. Run this test bootstrap as `bootstrap_admin`, then configure `DATABASE_URL_MIGRATIONS` for the distinct `wacrm_migrator` login.
- The bootstrap preflight also requires `current_database() = 'postgres'`, matching its explicit `ALTER DATABASE postgres` statement. Use only the dedicated disposable cluster/database described above.
- Do not connect the runner as PostgreSQL superuser to make historical OWNER TO postgres statements pass.
- `wacrm_migrator` is the distinct LOGIN NOSUPERUSER connection identity. The runner validates it, then uses `SET ROLE postgres` for the migration transaction; the dedicated `postgres` owner role is NOLOGIN NOSUPERUSER and owns migration-created objects.
- Preserve the historical `OWNER TO postgres` statements unchanged. The chain and its function bodies, signatures, EXECUTE grants, and search paths are exercised as written; no migration SQL is rewritten to work around ownership.
- The migration login and owner role are privileged relative to runtime/job roles and must not be exposed to app request code. The login has no direct CREATE on `public`; the bootstrap revokes CREATE from `PUBLIC` and grants it only to the NOLOGIN owner. The runner's `SET ROLE` is the intended path.

## On-demand broadcast counter repair
Migration 005 retains `public.recompute_broadcast_counts(uuid)` as an operator repair for counter drift; the incremental trigger does not call it. Migration 027 revokes direct execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`, leaving execution to the function owner. An authorized operator must use a controlled database session with membership that permits `SET ROLE` to the function owner, then run the repair inside a transaction, for example `BEGIN; SET LOCAL ROLE postgres; SELECT public.recompute_broadcast_counts('<broadcast-uuid>'::uuid); COMMIT;`. Do not grant this function back to `service_role`. The production operator identity, credential handling, and role membership remain unvalidated and must be defined with the H-DB-003 operation matrix; this task does not establish a production runbook.

## Evidence boundary
A successful run with these minimal compatibility objects proves migration-runner ordering, history, locking, replay, and SQL execution under the tested PostgreSQL image. It does not prove the app's identity model, Storage replacement, Realtime delivery, authorization semantics, production restore, or compatibility with every PostgreSQL release.

## Runtime/job role placeholders — 2026-10-16
H-DB-002/H-DB-003 define separate `wacrm_runtime` and `wacrm_job` identities, neither owner nor `BYPASSRLS`, with an explicit per-table/per-operation grant matrix and independent credentials/pools. The test bootstrap now creates both as LOGIN/NOINHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS and explicitly grants database CONNECT. This does not assert that CONNECT is the only effective privilege because PUBLIC defaults remain. `role-boundary-probe.sql` asserts no role memberships, schema CREATE, database CREATE, or table SELECT/INSERT/UPDATE/DELETE. These roles intentionally cannot serve app traffic yet. Grant matrix remains deferred until server repositories, authenticated account context, and named background-job operations are implemented in their own approved slice.

## Review corrections — 2026-10-16
The runner's CLI requires explicit `WACRM_MIGRATION_OWNER_ROLE`; there is no CLI fallback to a login-capable default owner. Both effective login and owner attributes are checked before lock acquisition: login must be LOGIN, owner NOLOGIN, and both must be NOINHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS. `WACRM_MIGRATION_LOCK_TIMEOUT_MS` bounds waiting for the advisory lock. Checksums use normalized LF and accept only the current canonical digest or legacy raw-byte LF/CRLF digests.

Forward migration 027 revokes EXECUTE from PUBLIC and named API roles on internal SECURITY DEFINER trigger/recompute helpers. `is_account_member` revokes PUBLIC/anon and explicitly grants authenticated/service_role; recompute_broadcast_counts remains owner-only. Since migration 017 policies omit `TO`, a role such as `anon` with table SELECT reaches those policies but is denied at the helper. The role probe verifies this expected denial with temporary transactional SELECT on `public.contacts`. Any future role granted access to tables whose policies call this helper also needs explicit EXECUTE, or role-scoped policies. Runtime/job have only explicit CONNECT grants; effective PUBLIC defaults still apply, and they are not account-isolation identities.

The reproducibility workflow includes the full database dump (`auth`, `public`, `storage`, and publication objects), restores into a clean database, and compares exact table, column/default, policy, auth trigger, migration ledger/checksum, and publication manifests. This remains disposable PostgreSQL evidence; it does not validate Supabase Auth/Storage/Realtime services or production restore.

Superseded (2026-10-18): this pre-rewrite scan result no longer describes the tree; `docs/environment-variables.md` is absent from the working tree and untracked-file status is not current. See the 2026-10-18 local history cleanup record in task.md. Historical text follows. Global Gitleaks 8.21.2 was rerun after documentation changes with Docker `--network none`, read-only checkout, and redaction. It returned exit 1 with three generic-api-key matches, all on pre-existing untracked `docs/environment-variables.md` (lines 38/42; historical commits `be7edfd…`, `7148c20…`). This is an inherited finding. The task-owned additions did not alter that file; do not characterize the whole-repository scan as clean.

Owner decision recorded 2026-10-17: bootstrap directly grants runtime/job only CONNECT and no explicit data privileges. The role probe checks selected effective privileges, not all ACLs. PostgreSQL PUBLIC defaults are outside that assertion, including USAGE on `public`, TEMP on the database, and EXECUTE on ordinary functions. This records the owner's policy of no explicit data grants for runtime/job, without asserting those defaults are absent; it does not authorize future grants, application traffic through these roles, or Supabase service replacement.
