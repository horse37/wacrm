# Task — Evolution GO + PostgreSQL self-host migration

- id: `20261015-223715475-obxw`
- status: complete
- type: migration
- slug: `evolution-go-postgresql-selfhost`

## Goal
Migrate WACRM from Supabase and Meta Cloud API to Evolution GO and self-hosted PostgreSQL through small, verifiable slices.

## Context
The existing plan is `plano-de-acao/plano-de-acao-evolution-go-postgresql.html`. The user reaffirmed PostgreSQL as the selected database and confirmed Supabase will not be used. Current code still uses Supabase for PostgreSQL access, Auth, RLS, Storage, and Realtime; PostgreSQL alone replaces only the database. Current baseline will run against a dirty checkout containing preexisting changes.

## In scope
- Begin with H-MIG-001 baseline and phase 02 inventory defined by the existing plan.
- Map provider/database boundaries, account isolation, rollback, and test coverage.
- Recommend a first implementation slice based on that evidence.

## Out of scope for the first slice
- Changing application behavior or migrating services before baseline and inventory are reviewed.
- Starting or contacting Supabase local/remote, production, homologation, VPS, or real WhatsApp chips.
- Branch changes, staging, commits, pushes, deployments, or cleanup of preexisting work.

## Validation
- Baseline commands recorded from the previous Docker run: `npm test` (Vitest, exit 0; count not retained) and `npm run typecheck` (exit 0), against the current dirty checkout. These checks were not rerun in this continuation.
- Source inventory is inspection-only; distinguish current Supabase/Meta paths from target PostgreSQL/Evolution GO paths.
- All outputs must record exact command, exit code, failures, warnings, and dirty-checkout limitation.

## Progress (2026-10-16)
- Baseline and inventory are recorded in `supabase-postgres-inventory.md`.
- Read-only `rtk rg -l --glob '!**/*.test.*'` searches reproduced the inventory counts: 40 Auth/client construction files, 21 direct data API files, 2 Storage files, 3 Realtime files, and 16 Meta provider files.
- Serena located the server/client Supabase factories and confirmed server factory consumers across account, automations, flows, invitations, and WhatsApp routes.
- Ruflo reviewer agent-1792115629947-lw1jvv and task task-1792116093374-wz8pzm were recorded; execution failed with No LLM provider configured. The task is blocked, agent terminated, and swarm swarm-1792115416622-met4lq shut down. No independent approval is claimed.
- No application behavior changed. Baseline tests were not rerun in this continuation.

## Review and continuation evidence (2026-10-16)
- Ruflo MCP review attempt used swarm `swarm-1792150264953-71ilho`, task `task-1792150377695-owygv0`, and agent `agent-1792150377845-72p30n`; `agent_execute` failed with `No LLM provider configured`. `Get-Command ruflo` and `Get-Command claude-flow` found no local CLI. No Ruflo review approval is claimed.
- Read-only Codex review `/root/wacrm_docs_audit` returned six findings. Main-session line checks rejected its claim that `postgresql-design.md` and `task.md` were truncated. Revalidation confirmed gaps in RLS defense in depth, auth/session lifecycle, elevated-role isolation, migration compatibility, and the stale Auth.js plan recommendation.
- Updated H-DB-002/H-DB-003 criteria and aligned the plan recommendation to Better Auth plus PostgreSQL RLS defense in depth. No app/provider code changed and no tests ran.

## Next action
Keep this design task open until an independent read-only review approves the corrected evidence and migration direction. Better Auth primary docs are now readable and checked; app-specific session policy still needs an explicit decision before auth implementation. After review, create a separate scoped HARNESS task for a server-only `pg` pool plus ordered migration runner. That task must validate the actual WACRM schema/migration path in isolated Docker PostgreSQL before migrating application consumers. Keep current application/provider code unchanged.
- Evidence boundary: duplicate synthetic history-row inserts prove deduplication only; they do not prove that a migration runner executes migrations once. The raw execution log is preserved, and its broader migration replay summary must be read within the assertion boundary above.

## Risks
Auth/RLS, Storage, and Realtime need explicit substitutes; a direct database cutover can break account isolation and inbox behavior. Existing WACRM changes are not owned by this migration and must stay out of any future commit.
## Synthetic PostgreSQL proof record (2026-10-16)
- The task-owned Docker proof passed; exact commands and results are in `validation-hdb002-docker-20261016.log`.
- It used `postgres:16-alpine`, network `none`, tmpfs data, read-only SQL, `--rm`, no named volume, and synthetic roles/accounts only.
- Assertions covered role privilege flags, migration-history row deduplication only (runner replay not exercised), fail-closed/account-scoped RLS, cross-account write denial, transaction-local context reset, runtime DDL denial, transactional rollback, a lock contender result whose session overlap was not recorded, and dump/restore with two synthetic rows.
- It did not validate the actual WACRM schema/migration chain, `pg` pool, Auth, Storage, Realtime, or application routes. No application migration is approved by this evidence.
- Context7 session-documentation output was opaque. The official PostgreSQL adapter, email/password, and session-management docs were fetched directly and checked on 2026-10-16. No application-specific session lifetime/rotation policy was selected. Previous Ruflo attempts failed; the new review attempt and status are recorded in the current handoff.

## Corrective evidence (2026-10-16)
- `validation-hdb002-corrective-20261016.log` records a supplemental disposable Docker proof. PostgreSQL 16.14, `--network none`, tmpfs, `--rm`, no named volumes, synthetic roles/rows only.
- Two overlapping sessions were demonstrated: the script observed the holder's granted advisory lock in `pg_locks`/`pg_stat_activity` before starting the contender; `pg_try_advisory_lock` returned `f` while the holder was still running.
- `has_schema_privilege('wacrm_runtime','public','CREATE')` returned false on the test PostgreSQL 16.14 cluster without an explicit revoke in the proof SQL. The assertion also ran after restore. Keep it as a runtime check; do not generalize this default to untested PostgreSQL versions.
- `pg_dump -Fc` restored into a separate fresh PostgreSQL cluster after creating synthetic role names. Assertions confirmed RLS enabled/forced, policy USING and WITH CHECK, runtime SELECT grant, runtime/job role flags, and two synthetic rows. This is not a WACRM backup acceptance test.
- `validation-hdb002-followup.sql`, `.sh`, and `.dump` are retained supplementary artifacts. Original `postgresql-proof.sql` and `validation-hdb002-docker-20261016.log` remain unchanged. Their history-row inserts do not exercise a runner; the SQL error string and broad log sentence are superseded by this explicit interpretation.
- Better Auth official docs checked from the current repository source: PostgreSQL adapter `Pool` example; database sessions by default when configured (secondary storage changes session storage; no database enables stateless mode); documented default expiry 7 days and refresh `updateAge` 1 day. These are library defaults, not an approved app policy. No absolute lifetime or token-rotation policy was selected.
- No WACRM application code, actual migration runner, or actual migration chain was exercised. Independent review remains required before the next implementation task.
- A fresh Ruflo review attempt used swarm `swarm-1792156670604-9o2uun`, reviewer `agent-1792156905217-xd99g0`, and task `task-1792158023305-jmvaia`. `agent_execute` failed with `No LLM provider configured`; task marked blocked, agent and swarm terminated. No independent review approval is claimed.




## Explicit implementation gate — 2026-10-16

**Status: BLOCKED; independent approval is required before implementation.** Do not create or execute the proposed pg pool, ordered migration runner, actual WACRM migration-chain test, or any service-replacement implementation task until an independent read-only reviewer reviews the corrected evidence and explicitly approves the migration direction. The current Ruflo review attempt failed because no LLM provider is configured. No independent approval exists.

This gate does not reject the design on technical merit. After approval, use a separate HARNESS task and disposable Docker PostgreSQL to validate the real migration chain, replay, concurrency, failure recovery, pool reuse, roles, isolation, and restore.

## Independent design review update — 2026-10-16

- Independent read-only review approved the H-DB-002/H-DB-003 direction as a planning proposal. It did not approve application implementation.
- One MEDIUM finding required explicit cluster-role provisioning, membership, ownership, grant, and security-flag checks for restore acceptance. This was added to postgresql-design.md before the validation gate.
- Next action: obtain read-only confirmation that the restore correction resolves the MEDIUM; keep implementation BLOCKED until then.

## Closure — planning and inventory complete (2026-10-16)
- **Result:** Completed the inventory, synthetic PostgreSQL evidence review, and H-DB-002/H-DB-003 planning proposal only.
- **Independent review:** A read-only Codex reviewer approved the direction as a planning proposal. It identified a MEDIUM about restoring cluster roles, memberships, ownership, and grants; the design was corrected, and the independent follow-up confirmed the correction. This is not approval to migrate application services or deploy.
- **Validation:** Historical Docker/PostgreSQL evidence and review records are referenced above. No tests, build, Docker run, or Gitleaks were executed during this closure update.
- **Remaining risk:** The actual WACRM migration chain, pool, runner replay/concurrency/failure recovery, and application-level auth/storage/realtime remain unvalidated.
- **Follow-up:** Task `20261016-122249401-af84` owns the server-only `pg` pool, ordered migration runner, and disposable PostgreSQL validation.