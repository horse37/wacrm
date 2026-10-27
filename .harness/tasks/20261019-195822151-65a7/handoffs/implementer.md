# Implementer handoff — PostgreSQL internal DB contract

## Start state
- Task: `20261019-195822151-65a7` (`postgres-db-contract`), H-DATA-001, `in_progress`.
- Branch `main`, HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Existing user-owned dirty work from the parent task must be preserved.
- Parent task `20261016-122249401-af84` remains `in_progress`; its six-item review approval is scope-limited.
- Target: PostgreSQL in disposable Docker Desktop only. Do not access Supabase.

## Baseline inspection
- Existing `src/lib/db/postgres-pool.ts` exports `getPostgresPool()` and documents a server-only usage convention without an automated import guard.
- No other DB contract module exists under `src/lib/db` at task start.
- The planned H-DATA-001 scope is query client, transaction helper, error categories, consistent return convention, and focused helper tests.

## Current progress
- Task record created and made the active HARNESS pointer at the owner's direction to proceed to H-DATA-001.
- Implemented the internal DB contract in `src/lib/db/errors.ts` and `src/lib/db/postgres-client.ts`; pool behavior remains intact for the preceding migration runner.
- Added focused contract tests and disposable PostgreSQL integration helpers. `server-only` is an exact dependency and the client module is protected by its Next.js guard.
- Focused Vitest passed 23/23; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier check passed.
- TDD regression: `node node_modules/vitest/vitest.mjs run src/lib/db/postgres-client.test.ts` failed before the fix with the expected false-success result, then passed 10/10 after the fix.
- Exact focused commands: `node node_modules/vitest/vitest.mjs run src/lib/db/postgres-pool.test.ts src/lib/db/postgres-client.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/eslint/bin/eslint.js --max-warnings=0 src/lib/db/errors.ts src/lib/db/postgres-client.ts src/lib/db/postgres-client.test.ts src/lib/db/postgres-pool.ts src/lib/db/postgres-pool.test.ts`; `node node_modules/prettier/bin/prettier.cjs --check package.json package-lock.json src/lib/db/errors.ts src/lib/db/postgres-client.ts src/lib/db/postgres-client.test.ts src/lib/db/postgres-pool.ts src/lib/db/postgres-pool.test.ts scripts/testing/postgres-db-contract-integration.mjs scripts/testing/typescript-extensionless-loader.mjs scripts/testing/register-typescript-extensionless-loader.mjs`.
- Final Docker PostgreSQL 16 smoke passed using `--network none`, tmpfs, `--rm`, read-only repository mount, no published ports/volumes; parameterized query, commit, rollback, caught query-error failure, persisted row, and pool shutdown verified. Evidence: `validation-postgres-db-contract-3a38263863.log`. Two earlier runner attempts failed before SQL execution on Node TS module resolution; the final harness fixes are recorded and passed.
- Gitleaks 8.21.2 directory scan passed after the transaction correction and final review-result record on the full read-only checkout including untracked files: exit 0, no leaks. Evidence summary: `validation-gitleaks-dir-post-fix-20261019.log`; the final scan output was recorded in the executor session after freezing these records.
- Internal review found a callback could catch a SQL error and cause a false-success result. Added a regression test first, observed the expected failure, fixed the transaction helper, and reran focused tests/integration successfully.
- Independent read-only review of the corrected slice returned `APPROVE`, zero findings and zero caveats. Reviewer confirmed the false-success correction and its unit/real-PostgreSQL tests. Approval remains limited to H-DATA-001; task stays `in_progress`.
- This evidence covers only the H-DATA-001 contract slice. Full app suite/build, H-DATA-002, app consumers, Supabase, Auth, Storage, Realtime, traffic, and production were not exercised.

## Next action
Keep this task `in_progress`; H-DATA-002 is the next separate slice. Continue with PostgreSQL in Docker Desktop only and preserve all out-of-scope boundaries.
