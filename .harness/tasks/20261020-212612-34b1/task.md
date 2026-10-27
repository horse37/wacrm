# PostgreSQL WhatsApp config POST

- Task: `20261020-212612-34b1` (`postgres-whatsapp-config-post-route`)
- roadmap: `H-DATA-003`, phase 03
- Status: `in_progress`
- Branch / baseline: `main` / `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`

## Goal and limits

Move only `POST /api/whatsapp/config` data reads and writes to the existing account-scoped PostgreSQL repository. Keep verified Supabase session as the Auth boundary, current Meta behavior, and HTTP response contract. Reserve `phone_number_id` through PostgreSQL's existing global unique constraint before registration or subscription mutations. Meta helpers stay mocked in tests.

No Supabase database/service-role persistence, real Meta requests or credentials, GET/DELETE changes, Auth replacement, schema/RLS/grant changes, migrations, UI, real data, application traffic, VPS, production, commit, push, deploy, reset, restore, clean, rebase, or branch change. Use disposable PostgreSQL 16 in Docker Desktop only. Preserve all existing local changes. `H-DATA-003` and `H-DB-003` remain unapproved overall.

## Implementation and review remediations

- Verified server session is checked before repository or Meta work. Repository uses membership-derived account ID, minimum `admin` role (admin/owner), parameterized SQL, and transaction-local RLS identity.
- Same-number config already owns the global unique constraint, so POST skips preliminary upsert for that case. New or changed phone numbers are reserved before Meta registration/subscription calls in a disconnected state. If the final save fails, the HTTP error includes whether the reservation persisted and which Meta operations completed; tests assert the response and the persisted disconnected reservation. A new reservation is not reported as connected until the final local save succeeds.
- Changing phone number clears the previous number's `registered_at`; a registration timestamp is never carried to a different number. Regression test covers changed phone without PIN.
- Insufficient account role now returns a role-specific 403. Missing account/profile remains separately mapped. PostgreSQL SQLSTATE `42501` is logged and returned as a safe 500.
- Route tests cover registration-state database/authorization failures, update failures, unauthorized, same-number PIN re-registration, missing `waba_id`, non-fatal subscription failure, and final-save failure.
- The disposable PostgreSQL fixture supplies forced RLS, policies, and least-privilege grants for this integration proof. Within that fixture, tests prove owner and non-owner admin writes, preserve the pre-existing `user_id` from a separate admin member in the same account, verify global phone conflicts through both INSERT and UPDATE, and directly probe forced-RLS denials for viewer INSERT, agent UPDATE, and cross-account owner INSERT/UPDATE. Viewer UPDATE and agent INSERT are denied by the application account-role guard but are not direct RLS probes. The test also confirms NOBYPASSRLS/non-superuser and protected-column/DELETE/TRUNCATE grant boundaries. These are fixture properties, not proof that the repository's current schema migrations install them: the tracked migrations still lack FORCE RLS and runtime grants for `whatsapp_config`, and the UPDATE policy in migration 017 lacks `TO` and `WITH CHECK`. Schema/RLS/grant work remains a separate pending slice; no external Supabase service was used.
- Accepted residual concurrency risk: whether the same-number path skips a preliminary write or this POST first creates a disconnected reservation for a new/changed number, a concurrent DELETE or reassignment by another admin in the same account can release ownership before the Meta registration/subscription mutation. The final save then detects the lost reservation, but cannot undo the external Meta call. This narrow TOCTOU window is accepted for this slice; eliminating it requires coordinating a durable per-number lock with DELETE and all writers, which is outside scope.
- The shared `AppError`/PostgreSQL account-guard behavior keeps `reason` non-enumerable so the internal discriminator does not enter generic serialized error output. The guard test explicitly asserts the reason value and non-enumerability; this is the documented alternative to making it enumerable. Validation covers every test file importing these shared modules, not only the original five-file focus.

## Validation evidence

- All shared-module importer tests: **89/89 files, 919/919 tests passed** with `DATABASE_URL` and `TEST_DATABASE_URL` unset — `validation-second-review-shared-importers-remediation1-20261020.log`.
- Final focused WhatsApp routes, repository, and account-guard tests: **54/54 passed** — `validation-second-review-focused-final-20261020.log`.
- Disposable Docker Desktop PostgreSQL 16 integration: **SUCCESS**, including global phone conflict on INSERT/UPDATE and cross-account INSERT/UPDATE probes; cleanup confirmed with no residual task containers — `validation-postgres-whatsapp-config-post-f4c87254d44e.log`.
- Final `npx tsc --noEmit`: passed — `validation-second-review-typecheck-final-20261020.log`.
- Final targeted ESLint with `--max-warnings=0`: passed — `validation-second-review-eslint-final-20261020.log`.
- Final targeted Prettier `--check`: passed — `validation-second-review-prettier-final3-20261020.log`.
- Final `git diff --check`: passed — `validation-second-review-diff-check-final3-20261020.log`.
- The intermediate run that temporarily made `AppError.reason` enumerable failed 34 existing equality assertions; that exposure was reverted in favor of the documented non-enumerable internal discriminator. The final 89-file/919-test run above passes and supersedes that experiment.

## Review

A revisão independente read-only GPT-6 Luna retornou `APPROVE`, zero achados e zero ressalvas para a correção documental/evidencial dos dois itens apontados pela Opus nesta fatia POST. Relatório: `review-gpt6-luna-final-20261020.md`. A aprovação limita-se à documentação e evidências descritas nesse relatório; não encerra esta task HARNESS, não aprova outras rotas e não representa aprovação global de H-DATA-003 ou H-DB-003.
