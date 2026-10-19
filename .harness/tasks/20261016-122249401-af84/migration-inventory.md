# WACRM SQL migration inventory — 2026-10-16

> Aviso (2026-10-18): as seções "Next action" / "Revised next action" deste arquivo são checkpoints históricos, superados pela implementação do pool e do runner. Não usar como próxima ação.

## Scope and commands
- Read-only scan of every .sql file in the WACRM checkout.
- rtk rg --files -g '*.sql' — exit 0; 26 SQL files, all under supabase/migrations/, numbered 001 through 026.
- Exact marker command: rtk rg -n -i -g '*.sql' 'auth\.(uid|jwt)\s*\(|\bstorage\.|\bsupabase_realtime\b|\b(anon|authenticated|service_role)\b|CREATE\s+EXTENSION|CREATE\s+POLICY|ENABLE\s+ROW\s+LEVEL\s+SECURITY|FORCE\s+ROW\s+LEVEL\s+SECURITY' — exit 0; RTK reported 331 matches in 18 files. Output was truncated, so per-file classification below comes from a separate full-file static marker pass.
- Serena was activated for WACRM and searched the migration directory for the same dependency markers; tool response was opaque. The file list and classification were independently derived by read-only shell scans.
- No SQL was executed; no migration, app code, test, database, container, or volume was changed.

## Per-file marker classification
Legend: AUTH = auth.uid()/auth.jwt(); STORAGE = storage.* schema/helper; REALTIME = publication named supabase_realtime; ROLES = anon, authenticated, or service_role; EXT = CREATE EXTENSION; RLS = row-level-security policy/enable statements. PG_ONLY_STATIC means none of these markers appeared; it is not proof of full portability.

- 001_initial_schema.sql — AUTH, REALTIME, EXT, RLS
- 002_pipelines_enhancements.sql — PG_ONLY_STATIC
- 003_broadcast_recipient_wamid.sql — PG_ONLY_STATIC
- 004_contact_delete_set_null.sql — PG_ONLY_STATIC
- 005_broadcast_counts_incremental.sql — PG_ONLY_STATIC
- 006_automations.sql — AUTH, ROLES, RLS
- 007_automations_increment_counter.sql — ROLES
- 008_profile_avatars_storage.sql — AUTH, STORAGE, RLS
- 009_message_actions.sql — AUTH, REALTIME, RLS
- 010_flows.sql — AUTH, REALTIME, ROLES, RLS
- 011_profile_beta_features.sql — ROLES
- 012_flows_increment_counter.sql — ROLES
- 013_whatsapp_config_phone_number_id_unique.sql — AUTH
- 014_message_templates_meta_integration.sql — PG_ONLY_STATIC
- 015_whatsapp_config_registration.sql — PG_ONLY_STATIC
- 016_flow_media.sql — AUTH, STORAGE, RLS
- 017_account_sharing.sql — AUTH, ROLES, RLS
- 018_account_member_rpcs.sql — AUTH, ROLES
- 019_invitation_rpcs.sql — AUTH, ROLES
- 020_account_sharing_followups.sql — AUTH, STORAGE, RLS
- 021_account_default_currency.sql — PG_ONLY_STATIC
- 022_contact_phone_dedup.sql — PG_ONLY_STATIC
- 023_chat_media.sql — AUTH, STORAGE, RLS
- 024_zap_lead_integrations.sql — ROLES, RLS
- 025_zap_lead_events_and_heartbeat.sql — ROLES, RLS
- 026_zap_lead_generation_safe_heartbeat.sql — ROLES

## Findings and limits
- 18 of 26 files contain at least one Supabase-specific marker; 8 contain none from the searched marker set.
- The 12 AUTH files depend on the Supabase auth.uid() helper in RLS policies or RPCs. PostgreSQL has RLS, but does not provide that helper or Supabase JWT context by default.
- Four files depend on the Supabase Storage schema/helpers (storage.buckets, storage.objects, storage.foldername). These are not supplied by plain PostgreSQL; MinIO/service replacement is outside this task.
- Three files target the Supabase-managed supabase_realtime publication. A PostgreSQL publication does not itself provide the Supabase Realtime service.
- Eleven files reference Supabase role names. These roles/grants need an explicit replacement mapping; anon, authenticated, and service_role are not PostgreSQL built-ins.
- Eleven files contain RLS/policy statements. RLS is PostgreSQL functionality; policies using auth.uid() need an explicit application-owned identity context before portability can be claimed.
- Migration 001 requests uuid-ossp; the target image must provide the extension and the migration role must be permitted to install it.
- The eight PG_ONLY_STATIC files still require syntax/object/dependency review. Marker absence does not prove they run on a clean PostgreSQL cluster.
- This scan does not establish migration order correctness, transactional compatibility, idempotency, data preservation, authorization semantics, or production readiness.

## Next action
Read the 18 flagged SQL files in task-sized groups and record required prerequisite objects and portability decisions. Decide how the disposable runner test provides missing Supabase schemas/roles without claiming to implement Auth, Storage, or Realtime. Do not edit source migrations until this compatibility boundary is documented.
## First dependency group and runner risk scan
- Targeted inspection covered migrations 001, 008, 016, 020, and 023. The auth policies depend on Supabase auth.uid(); media migrations create bucket rows and policies on storage.objects, and use storage.foldername. Migration 020 changes account-scoped and legacy uploader path rules. These SQL objects carry authorization/path semantics; a thin schema stub cannot prove the future Storage replacement.
- RTK search for transaction-disruptive commands (CREATE/DROP INDEX CONCURRENTLY, VACUUM, CREATE DATABASE, ALTER SYSTEM) returned exit 1 with no matches. This is a limited static scan, not proof every statement is safe in one transaction.
- RTK search for function/privilege constructs returned exit 0, 117 matches across 11 files. Output was truncated. SECURITY DEFINER and EXECUTE grants exist, so runner/migration role ownership, fixed search_path, and grants require dedicated review before any execution.
- No migration was executed. The chain has not been tested in PostgreSQL.

## Revised next action
Inspect the role/RPC migrations (006, 007, 009–013, 017–019, 024–026), especially SECURITY DEFINER ownership, search_path, and EXECUTE grants; then inspect the eight files with no searched vendor markers. Record exact prerequisite objects and the disposable test bootstrap before editing source SQL.
## Additional Auth, role, and ownership findings
- A targeted auth-schema scan found auth.users foreign keys in migrations 001, 006, 010, and 017; 001 and 017 also install the legacy handle_new_user trigger on auth.users. The earlier AUTH category therefore includes auth schema/table dependencies in addition to auth.uid() calls.
- Nine ALTER FUNCTION ... OWNER TO postgres statements occur in five files: 001 (1), 017 (2), 018 (3), 019 (2), and 022 (1). Do not solve this by running the migration chain as superuser. Keep function signatures, bodies, grants, and search_path unchanged; migration ownership needs task-specific handling.
- The migration SQL scan found no CREATE ROLE/USER or ALTER DEFAULT PRIVILEGES statements. Supabase role names must be provisioned explicitly by the disposable test bootstrap or a separately reviewed production bootstrap.
- There are 30 SECURITY DEFINER markers in 11 migration files. They require checking function owner, search_path, and EXECUTE grants; the runner must assert migration identity owns the relevant objects.
- A repository-wide search found references to account/invitation RPCs in app routes/components and tests. This task must preserve those function contracts; consumer migration is out of scope.
- Proposed fixture and ownership limits are defined in compatibility-boundary.md. This is a test-only compatibility layer, not a self-hosted Supabase installation.
## Progress — directed scan of migrations 006–013 (2026-10-16)

A read-only marker scan was run against the numbered migrations. It is a triage aid, not proof that a migration is portable or that its runtime contract works on plain PostgreSQL.

- `006_automations.sql`: 6 matches for Auth-related markers and 7 policy statements.
- `007_automations_increment_counter.sql` and `012_flows_increment_counter.sql`: each has one `SECURITY DEFINER` function and four `GRANT`/`REVOKE` statements. These PostgreSQL constructs are valid independently of Supabase, but their RPC callers, ownership, `search_path`, and effective privileges still need semantic verification.
- `008_profile_avatars_storage.sql`: Storage/Auth markers and 9 policy statements; requires a test-only Storage/Auth compatibility fixture to execute unchanged.
- `009_message_actions.sql` and `010_flows.sql`: each has Auth/Realtime/policy markers; publication and identity semantics need a dedicated fixture and must not be treated as Realtime service validation.
- `011_profile_beta_features.sql`: no Auth, Storage, Realtime, `SECURITY DEFINER`, ownership, or grant marker in the targeted scan; a generic policy-word match alone is insufficient to classify it as Supabase-dependent.
- `013_whatsapp_config_phone_number_id_unique.sql`: one Auth-related marker; inspect the surrounding statement before assigning a bootstrap dependency.

The broader filename scan surfaced Storage/Auth markers in `014`, `016`, and `023`; policy/RPC/ownership-related markers in `021` and `022`; and no such marker in `015`. These remain in the semantic review queue alongside the exact bootstrap requirements for Auth, Storage, and Realtime. No migration SQL was executed or changed.

### Next action

Complete the semantic pass over migrations `014–023`, checking exact objects, function signatures, owners, `search_path`, and grants. Then reconcile the task's flagged-file count against the marker definition and record the minimal disposable-cluster bootstrap. Keep the migration runner non-superuser; do not hide `OWNER TO postgres` requirements by granting an application role superuser access.
## Progress — semantic pass of migrations 014–023 (2026-10-16)

The executable SQL (comments excluded) was screened separately from marker comments:

- `014_message_templates_meta_integration.sql`, `015_whatsapp_config_registration.sql`, and `021_account_default_currency.sql` have no Auth, Storage, Realtime, `SECURITY DEFINER`, explicit owner, or grant/revoke references in executable lines. The observed operations are ordinary PostgreSQL table/index changes.
- `016_flow_media.sql`, `020_account_sharing_followups.sql`, and `023_chat_media.sql` contain executable `auth.uid()` references and use `storage` objects/policies. A migration-chain fixture must provide only compatible database objects and synthetic identity behavior; it does not validate Supabase Storage or Auth services.
- `022_contact_phone_dedup.sql` defines `public.merge_duplicate_contacts()` as `SECURITY DEFINER`, sets `search_path = public`, changes owner to `postgres`, and revokes all execution from `PUBLIC`. The scan found no explicit `GRANT`; verify this contract and the required ownership privilege. Do not grant the application runtime superuser capability to make this statement pass.

The task's historical count of 18 flagged files still needs reconciliation against a code-only marker definition; comments are not evidence of an executable dependency. The Superseded (2026-10-18): migration SQL unchanged; the 27-file chain was applied and replayed in disposable PostgreSQL 15 (see task.md, 2026-10-18 validation).

### Next action

Reconcile the flagged-file inventory from executable SQL, inspect role/function privileges and bootstrap ordering, then implement the pool and ordered runner with explicit test-only Auth/Storage/Realtime objects. Validate the actual chain in disposable Docker PostgreSQL using a migration identity that cannot act as superuser; stop and document a blocker if the existing `OWNER TO postgres` contract cannot be preserved safely.
## Progress — PostgreSQL 15 ownership probe (2026-10-16)

A temporary Docker PostgreSQL 15 container used `tmpfs` (no named or persistent volume). A first probe failed with `permission denied for schema public` because the non-login owner lacked `CREATE` on `public`; this identified a missing bootstrap grant. With `postgres` created as `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, `wacrm_migrator` created as `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`, and explicit `USAGE, CREATE` plus role membership granted, a direct TCP login as `wacrm_migrator` successfully created a `SECURITY DEFINER` function, changed its owner to `postgres`, and revoked `PUBLIC` execution (exit 0). The query returned `wacrm_migrator|wacrm_migrator|false|postgres|false`: session/current user match, migrator is not superuser, owner is `postgres`, and `PUBLIC` has no EXECUTE privilege. PostgreSQL emitted the warning `no privileges could be revoked for "owner_probe"`; it did not fail the command, and the ACL query confirmed the intended no-PUBLIC-execute state.

This proves the ownership syntax can work with a non-superuser migration login when the owner role is itself non-superuser and schema privileges are explicit. It is a representative privilege probe only; it does not prove the WACRM migration chain. Each temporary container used `--rm` and `tmpfs`; no persistent Docker volume was created or changed.

The executable-SQL screen yields different counts depending on scope: 11 migration files contain direct Auth/Storage/Realtime references; 13 contain those references or executable policy DDL; 19 match the broader set including SECURITY DEFINER, owner, grants, and policy terms. The prior “18 flagged” count therefore needs per-file reconciliation before implementation; do not use the broad count as a Supabase-dependency count.

### Next action

Superseded (historical; the pool and runner were implemented). Finish the row-by-row classification of the 26 migrations and identify the minimal test bootstrap, then implement the server-only pool and ordered runner. Keep the runner's connection identity non-superuser and the owner role non-login/non-superuser. The full migration-chain Docker proof remains pending.
## Bootstrap contract for disposable PostgreSQL validation (2026-10-16)

The code-only scan identified these prerequisites for the historical chain:

- `001_initial_schema.sql` creates `uuid-ossp` and alters the existing `supabase_realtime` publication; publication membership is also changed in `009_message_actions.sql` and `010_flows.sql`. The disposable server must start with `wal_level=logical`, and the test bootstrap must create `supabase_realtime` before applying migration 001.
- Auth references include `auth.users` and `auth.uid()`. The minimum test fixture needs an `auth` schema, a synthetic `users(id uuid primary key)` target, and a function stub for `auth.uid()`. It exercises SQL compilation and policy creation only; it is not Auth validation.
- Storage policies in migrations `008`, `016`, `020`, and `023` reference `storage.buckets`, `storage.objects`, and `storage.foldername(name)`. Test definitions must expose only the columns and helper signature those policies use; this does not validate file upload, storage authorization, or the Supabase Storage service.
- Existing grants name `anon`, `authenticated`, and `service_role`; create non-login test roles with those names. `postgres` remains a separate `NOLOGIN NOSUPERUSER` object owner, while the runner login is `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE` with only required schema/database grants and owner-role membership.
- The code scan found no `CREATE INDEX CONCURRENTLY` or explicit `BEGIN`/`COMMIT` in migration files; per-file transactions remain a viable runner design, subject to the full-chain run.

This is the test fixture boundary. No compatibility schemas, roles, or stubs belong in production migrations unless a separate architecture task explicitly adopts them.

### Next action

Superseded (historical; implemented). Implement the lazy server-side PostgreSQL pool, migration discovery/checksum runner, and focused runner tests. Then execute all 26 SQL files in order on a fresh disposable PostgreSQL 15 cluster with the fixture above and a direct non-superuser migration connection.
### Follow-up migration 027 and review validation — 2026-10-16
The original inventory covers migrations 001–026. This task adds `027_restrict_broadcast_recompute_execute.sql` as a forward-only privilege correction, without rewriting applied migration checksums. It removes inherited PUBLIC execution from internal SECURITY DEFINER helpers and keeps the explicit `authenticated`/`service_role` grants for `is_account_member`. The final role probe observed 0 callable public SECURITY DEFINER functions for `wacrm_runtime` and `wacrm_job`; direct ACL inventory and table grants are checked separately. The probe remains synthetic and does not approve production runtime/job grants.
