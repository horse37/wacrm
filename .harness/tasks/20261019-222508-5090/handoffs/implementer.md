# Implementer handoff — PostgreSQL account invitation revocation repository

## Start state

- Task: `20261019-222508-5090`, `postgres-account-invitation-revoke-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and prior task evidence.
- PostgreSQL only in task-owned disposable Docker Desktop resources; no Supabase.

## Scope boundary

Implement only the server-only invitation revocation repository method. Require admin+, derive account scope from the verified guard, bind invitation ID/account ID, preserve hard-delete and not-found semantics. Existing route stays untouched/unwired. Do not change schema, grants, RLS, Auth/session policy, or other operations.

## Progress

- Opened after independent same-model Luna `APPROVE` for invitation list and invitation create repository slices, each limited to that slice.
- Existing `DELETE /api/account/invitations/[id]` hard-deletes by ID through Supabase RLS and returns 404 if no visible row. PostgreSQL implementation should make account scoping explicit and preserve cross-account non-disclosure.
- Added `revoke` to the server-only repository. It requires admin+, sets verified identity transaction-locally, deletes by guard-derived account ID and bound invitation ID, and returns a boolean to preserve 404 behavior without leaking cross-account existence.
- TDD RED failed 6/6 because the method was absent. Focused Vitest then passed 38/38 across six account repository/guard files; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic two-account fixtures, `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, and no published ports/named volumes. It verified hard-delete, account isolation, no-row behavior, role/session denial, and transaction identity cleanup. Log: `../validation-postgres-account-invitation-revoke-50f70d10e3.log`.
- Same-model Luna read-only reviewer returned `APPROVE`, zero findings/caveats, limited to this repository slice; no edits/tests were made during review.

## Next action

Continue with the next narrow H-DATA-003 account repository slice. Keep this task `in_progress` and the route unwired pending verified-session integration and least-privilege grant approval.
