# H-DB-002 — PostgreSQL self-host design

**Status:** independent read-only review approved this as a planning proposal; implementation remains gated on task-owned Docker validation and an approved ADR; a synthetic disposable Docker proof passed on 2026-10-16. Actual WACRM schema/migration/pool integration remains unvalidated. Not production deployment approval.
**Scope:** PostgreSQL connection, roles, migrations, pool, backup/restore, and secret handling. Auth, account authorization/RLS, object storage, realtime, and WhatsApp provider remain separate H-DB-003 decisions.

## Decision

- PostgreSQL is the only database target. Do not start or use Supabase locally or remotely.
- Use a private `DATABASE_URL` to connect to PostgreSQL. In Docker Compose, app containers use the database service DNS name and internal port `5432`; publish a host port only when local tooling needs it. Do not hardcode hostnames, ports, database names, or credentials in application code.
- Keep existing application tables in schema `public` for the first migration slices. This matches the current SQL layout and avoids mixing schema redesign into provider replacement. Supabase-managed schemas and services are not part of the target.
- Use three database identities: a non-superuser runtime role for normal requests, a separately restricted elevated role for explicitly authorized jobs/webhook operations, and a migration owner used only by the migration runner. No runtime role may create roles, databases, extensions, or schemas.
- Use one bounded `pg` pool per Node.js process. Set pool size and timeouts through server-only configuration. Compute the deployed pool budget across maximum app replicas before deployment; a per-process limit is not the database-wide limit. Do not add PgBouncer until measured concurrency requires it.
- Keep migrations as ordered, versioned SQL files, reusing and reviewing existing SQL as migration input. A dedicated runner applies each version once and records it in a migration-history table. Application startup must not run DDL. A failed migration must stop the release; rollback is a forward corrective migration unless the change has a tested reversible operation.
- Keep database credentials in ignored local environment files for Docker development and in the deployment secret store for hosted environments. `.env.example` contains variable names and non-secret examples only. Never log connection strings.
- For disposable Docker validation, exercise schema creation from an empty database, migration replay protection, backup/restore, and synthetic cross-account fixtures. Use task-owned disposable containers/volumes only; preserve existing containers and volumes.

## Role boundary and migration safety

- Maintain a grant matrix by database role, table, and operation. Runtime and job roles must not own application tables or have `SUPERUSER`, `CREATEROLE`, `CREATEDB`, or `BYPASSRLS`.
- Keep elevated credentials and pool in a server-only module imported only by named jobs/webhooks. Normal request modules and browser bundles must not be able to obtain that client; enforce this with an import-boundary check.
- The migration runner takes a PostgreSQL advisory lock. Apply each migration once; use a transaction where supported. Mark non-transactional DDL explicitly and document recovery from partial failure.
- Use expand/contract changes so the deployed and previous application versions remain compatible during rollout. Failed migrations stop release. Rollback must be a tested reversible operation or a forward corrective migration, not an assumption that restoring an old app version is sufficient.

## Backup and recovery target

- Use PostgreSQL custom-format logical dumps (`pg_dump -Fc`) for portable backups and `pg_restore` into a clean disposable database for restore verification.
- Proposed initial retention target: 14 daily backups and 8 weekly backups, encrypted outside the database host. This is a planning default, not a production retention policy; production activation must also define owner-approved RPO/RTO and backup destination.
- A backup is not accepted until an automated restore check validates schema, constraints, and synthetic row counts. A dump alone does not authorize cutover.

## Restore role provisioning and acceptance

- Provision application roles, role attributes, and memberships separately before restoring the database, using reviewed, idempotent bootstrap SQL or infrastructure automation. Supply passwords through deployment secrets; do not put plaintext credentials in dumps or documentation. A globals-only dump may contain password hashes and requires restricted handling if used.
- Restore the custom-format database dump only after required roles exist, preserving intended ownership and ACLs. Reconcile the migration owner, runtime role, and restricted job role explicitly; do not silently restore all objects under a superuser or runtime identity.
- Restore acceptance must verify expected roles and memberships, database/schema/object ownership, schema and table grants, and security flags. Confirm the runtime role cannot become superuser, bypass RLS, create roles/databases, or create schemas in the application namespace. Fail acceptance on any missing role or privilege.
## Validation gate

The first implementation task must add a disposable PostgreSQL Docker test path, apply the migration chain to an empty database, run focused integration tests, and restore a generated dump into a second disposable database. Record Docker image/version, exact commands, exit codes, and preserved-volume checks. Do not claim this design is runtime-validated until those checks pass.

## Docker validation gate

Use task-owned disposable PostgreSQL containers only; preserve existing containers and volumes. Validate an empty-database migration, concurrent-run serialization, replay protection, transactional failure recovery, actual role grants, fail-closed account policies, and pooled-connection reuse. Create a custom-format `pg_dump` and restore it into a second clean disposable database; verify schema, constraints, role separation, and synthetic row counts.

- Evidence boundary: the synthetic history-row check proves uniqueness/deduplication of repeated inserts only. No runner was called. Keep runner replay protection as an unvalidated implementation gate; the original SQL and log remain unchanged as execution artifacts.

## Consequences and unresolved boundary

- PostgreSQL replaces database access only. It does not replace Auth, RLS/account isolation, Storage, Realtime, or Meta Cloud API.
- Current direct Supabase consumers make account isolation the highest risk. H-DB-003 defines server-side authentication and authorization plus transaction-local PostgreSQL RLS as defense in depth. Cross-account negative tests must cover normal requests, jobs, media, invitations, exports, and reused pooled connections before a data-access migration can be implemented.
- The present checkout has no PostgreSQL driver or database integration-test command. Adding these belongs to a separately scoped implementation task after service-replacement decisions are recorded.

## Synthetic Docker proof — 2026-10-16
- **Result:** SUCCESS for the task-owned synthetic proof, not WACRM application integration.
- **Runtime:** local `postgres:16-alpine` image `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`; `--network none`; PostgreSQL data in tmpfs; task SQL mounted read-only; `--rm`; no named volume or host port.
- **Original assertions:** role privilege boundaries; deduplication of repeated synthetic migration-history inserts (no runner was invoked); RLS fails closed without account context; account-scoped read succeeds; cross-account write is denied; transaction-local account context clears after commit; runtime DDL is denied; transactional DDL rollback leaves no table; old lock contender result `f` (the command record did not establish overlapping sessions); custom-format dump/restore returns two synthetic account rows.
- **Evidence:** `validation-hdb002-docker-20261016.log` and `postgresql-proof.sql` in this task directory. The corrected run exited 0. The first runner attempt exited 1 before SQL because it resolved a log path that did not yet exist; its task-owned container was stopped and auto-removed.
- **Limit:** this used a minimal synthetic schema. It did not exercise the actual WACRM schema or migration chain, application `pg` pool, Auth, Storage, Realtime, routes, or data consumers. These remain required gates before application migration or any production claim.

### Corrective synthetic assertions — 2026-10-16
- `validation-hdb002-corrective-20261016.log` and its `.sql`, `.sh`, and `.dump` artifacts supplement the original run without changing its SQL or log.
- A background holder's granted advisory lock was observed in `pg_locks`/`pg_stat_activity` before the contender started. The overlapping `pg_try_advisory_lock` returned `f`; this establishes concurrent lock contention for this synthetic run.
- PostgreSQL 16.14 `has_schema_privilege('wacrm_runtime','public','CREATE')` returned false without an explicit revoke in the proof SQL. This version-specific fact is recorded with a direct assertion; other PostgreSQL versions/environments must check grants too.
- A custom-format dump restored into a second fresh cluster after recreating the synthetic role names. Assertions verified two rows, RLS enabled/forced, the policy and WITH CHECK, runtime SELECT grant, no runtime CREATE on `public`, and no elevated runtime/job role attributes. This is not WACRM backup/recovery validation.
- Replay boundary remains unchanged: repeated inserts validate history-row deduplication only. No migration runner was executed; runner replay and the actual WACRM migration chain remain unvalidated.




## Historical proof wording and image identity — 2026-10-16

- In postgresql-proof.sql, the exception text "migration replay was not idempotent" labels the duplicate history-row assertion. The SQL performs repeated INSERT ... ON CONFLICT DO NOTHING and checks one row; it does not call a migration runner. The original execution log's broad "assertions covered migration replay" sentence must be read within that assertion boundary. Preserve the SQL and original log unchanged.
- The corrective proof log records the holder lock observed before the contender, the PostgreSQL 16.14 public CREATE privilege assertion, and policy/RLS/grant restoration into a second clean synthetic cluster. These do not validate the WACRM migration chain or a backup of WACRM.
- The original run invoked mutable reference postgres:16-alpine. A later local image inspection recorded RepoDigest postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777; this is reproduction metadata, but does not prove the historical run was launched by digest. Future proofs should record the resolved image ID/digest at launch.
