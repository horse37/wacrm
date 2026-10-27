# Task — PostgreSQL internal DB contract

- id: `20261019-195822151-65a7`
- type: migration
- slug: `postgres-db-contract`
- status: `in_progress`
- roadmap: H-DATA-001, phase 03

## Goal
Add a narrow internal contract in `src/lib/db` over the existing server-side `pg` pool: parameterized queries, managed transactions, consistent results, and typed database/domain errors.

## Context
The owner confirmed the target is PostgreSQL in Docker Desktop and Supabase will not be used. The existing `postgres-pool-migration-runner` task remains `in_progress`; its limited remediation approvals do not close or approve that entire task. This successor follows the H-DATA-001 recommendation in `plano-de-acao/plano-de-acao-evolution-go-postgresql.html`.

## In scope
- Typed query helper that accepts SQL values separately from SQL text.
- Transaction helper that obtains one pool client, begins/commits, rolls back on failure, and releases exactly once.
- Stable result and error types for `unauthorized`, `forbidden`, `not_found`, `conflict`, and `db_error`.
- Focused tests for result/error mapping and transaction lifecycle; use disposable Docker PostgreSQL only for any real-connection smoke.
- Record exact validation commands/results and remaining boundaries in this task and its implementer handoff.

## Out of scope
- Migrating route or repository consumers; removing existing Supabase client code.
- Auth/session policy, `requireAccount`/`requireRole`, account grants, RLS changes, or cross-account cutover.
- Storage, Realtime, Evolution GO, existing containers/volumes, production, real credentials/data, stage, commit, push, deploy, reset, clean, or branch changes.
- Any Supabase local, remote, or real service access.

## Validation
- Focused Vitest: `node node_modules/vitest/vitest.mjs run src/lib/db/postgres-pool.test.ts src/lib/db/postgres-client.test.ts` — passed, 23/23.
- Regression RED/GREEN: `node node_modules/vitest/vitest.mjs run src/lib/db/postgres-client.test.ts` first failed as expected (callback-caught unique violation returned `{ ok: true }`); after the helper fix it passed, 10/10.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` — passed.
- ESLint: `node node_modules/eslint/bin/eslint.js --max-warnings=0 src/lib/db/errors.ts src/lib/db/postgres-client.ts src/lib/db/postgres-client.test.ts src/lib/db/postgres-pool.ts src/lib/db/postgres-pool.test.ts` — passed, zero warnings/errors.
- Prettier check on changed TS/MJS/package files — passed.
- Gitleaks 8.21.2 `dir /repo --no-banner --redact` passed after the swallowed-query-error correction and final review-record update, exit 0, no leaks. Full checkout including untracked files was mounted read-only in a `--network none` container. Detailed post-fix evidence: `validation-gitleaks-dir-post-fix-20261019.log`; final scan output was recorded in the executor session after freezing this file.
- Disposable PostgreSQL integration: `scripts/testing/validate-postgres-db-contract.ps1` — passed. PostgreSQL 16 and Node 22 task containers used `--network none`, tmpfs database storage, `--rm`, read-only repository mount, no published ports or named volumes; cleanup found no residual task resources. It verified parameterized query, commit, rollback, caught query-error handling, persisted committed row, and pooled-client shutdown. Final evidence: `validation-postgres-db-contract-3a38263863.log`.
- Two earlier integration attempts failed in the Node harness before SQL execution because of TypeScript extensionless-import resolution and loader path; the runner was corrected and the final recorded execution passed. Earlier executor logs are retained for traceability.
- The focused validation did not run the full suite, app build, Auth/account guards, or consumer migration.

## Implemented
- `errors.ts` provides the five planned stable codes, safe `AppError` messages, discriminated `DbResult`, and unique-violation mapping (`23505` → `conflict`).
- `postgres-client.ts` is guarded by `server-only`; `queryDb` keeps values separate from SQL and returns rows/count; `withTransaction` owns BEGIN/COMMIT/ROLLBACK and releases one client exactly once, discarding it if rollback fails. A caught transaction query error is retained and forces rollback/failure rather than returning false success.
- Focused unit tests cover query parameter separation, safe error mapping, category vocabulary, transaction commit/rollback, caught query-error behavior, rollback failure, BEGIN failure, and release behavior.
- Docker smoke helpers: `scripts/testing/postgres-db-contract-integration.mjs`, `scripts/testing/typescript-extensionless-loader.mjs`, `scripts/testing/register-typescript-extensionless-loader.mjs`, and `scripts/testing/validate-postgres-db-contract.ps1`.
- `server-only` is an exact package dependency. Existing `postgres-pool.ts` stays importable by the prior plain-Node migration integration runner.

## Remaining boundaries
- Independent read-only review after the transaction correction: `APPROVE`, zero findings and zero caveats. Approval is limited to this H-DATA-001 slice; HARNESS task remains `in_progress` and unclosed.
- H-DATA-002 guards/authorization and consumer migration remain separate work. No Supabase service, Auth, Storage, Realtime, app traffic, production, or real data was used.

## Next action
Keep task `in_progress`; H-DATA-002 is a separate next slice. Continue only within PostgreSQL/Docker Desktop scope and preserve the exclusions above.
