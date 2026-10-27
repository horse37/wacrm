# Implementer handoff — PostgreSQL WhatsApp config POST

## State

- Task `20261020-212612-34b1`, H-DATA-003 phase 03, stays `in_progress`.
- Branch `main`, expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Worktree contains many earlier edits and untracked task artifacts. Preserve everything.
- No commit, push, deploy, reset, restore, clean, rebase, or branch change.
- The user authorized correction of the latest independent review and continuation of the narrow H-DATA-003 plan overnight. Complete the read-only GPT-6 Luna re-review before the next slice; stop at 09:00 BRT on 2026-10-21 and provide the exact checkpoint.

## Corrected findings

1. New/changed numbers reserve before Meta mutations in a disconnected state. A final-save error reports whether the reservation persisted and which Meta operations completed. Same-number requests still avoid preliminary writes.
2. The Docker PostgreSQL fixture creates forced RLS, policies, and least-privilege grants. Tests exercise owner/admin writes, preserved `user_id`, global phone conflicts on INSERT and UPDATE, and forced-RLS denials for viewer INSERT, agent UPDATE, and cross-account owner INSERT/UPDATE; viewer UPDATE and agent INSERT are application-guard denials, not direct RLS probes. These checks describe the fixture only; repository migrations still need a separate schema/RLS/grants slice.
3. Insufficient role has a distinct 403 message. PostgreSQL `42501` logs a server error and returns safe 500.
4. A different phone number clears old `registered_at`; test and task document this intentional contract correction.
5. Added route tests for database read failure, unauthorized, update failure, same-number PIN rotation, absent `waba_id`, non-fatal subscription failure, and final-save failures.

## Final validation

- Shared-module importer suite: **89/89 files, 919/919 tests passed**, with database URL environment variables unset — `validation-second-review-shared-importers-remediation1-20261020.log`.
- Final focused route/repository/guard suite: **54/54 passed** — `validation-second-review-focused-final-20261020.log`.
- Disposable Docker Desktop PostgreSQL 16 integration: **SUCCESS**, covering INSERT/UPDATE global conflicts and cross-account INSERT/UPDATE probes; cleanup confirmed — `validation-postgres-whatsapp-config-post-f4c87254d44e.log`.
- Final TypeScript and zero-warning ESLint passed — `validation-second-review-typecheck-final-20261020.log` and `validation-second-review-eslint-final-20261020.log`; final Prettier and `git diff --check` passed — `validation-second-review-prettier-final3-20261020.log` and `validation-second-review-diff-check-final3-20261020.log`.
- An intermediate enumerable-reason experiment failed 34 existing error-equality assertions. The property was restored to non-enumerable and directly tested; the final 89-file/919-test run passes and supersedes that experiment.

## Second independent review findings and disposition

- Final-save partial state: corrected with disconnected reservations and structured `partial_persistence` response; tests inspect both response and persisted reservation.
- Shared `AppError`/account-guard changes: `reason` remains intentionally non-enumerable to keep the internal discriminator out of generic serialized error output. The guard test explicitly asserts its value and non-enumerability; this is the documented alternative to making it enumerable. All 89 importing test files pass.
- POST-versus-DELETE TOCTOU: accepted and documented for both paths. After the same-number read or a new/changed-number disconnected reservation, a concurrent DELETE/reassignment by another admin in the same account can release the phone before a Meta mutation. The final save detects a lost reservation but cannot undo completed Meta effects. Removing this window requires a durable lock coordinated with DELETE and all writers, outside this slice.
- Tautological test: removed; same-number case now asserts one final save occurs after subscription and no preliminary write occurs.
- PostgreSQL proof: added global conflict-on-INSERT and direct cross-account UPDATE probes. Task documentation now says forced RLS/grants are fixture-only; existing migrations still lack those guarantees, which remain outside scope.

## Next action

O re-review independente read-only GPT-6 Luna aprovou, sem achados ou ressalvas, a correção documental/evidencial desta fatia POST. Registro: `review-gpt6-luna-final-20261020.md`. Esta aprovação não encerra a task HARNESS nem aprova H-DATA-003/H-DB-003 globalmente. Próximo passo autorizado: avançar para uma fatia estreita seguinte, continuando com PostgreSQL descartável no Docker Desktop e checkpoint às 09:00 BRT de 21/10/2026.
## Boundaries

Only disposable PostgreSQL in Docker Desktop. No Supabase database/services, VPS, production, real credentials/data, Meta calls, or application traffic.
