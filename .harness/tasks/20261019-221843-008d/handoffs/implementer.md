# Implementer handoff — PostgreSQL account invitation creation repository

## Start state

- Task: `20261019-221843-008d`, `postgres-account-invitation-create-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty work and all prior task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only a server-only repository insert for the existing invitation POST contract. Require admin+, derive `account_id` and `created_by_user_id` from the verified guard, and bind all supplied fields. Caller owns token generation and passes only the SHA-256 hash; repository never accepts or persists plaintext token and never returns the hash. Existing route stays untouched/unwired. No invitation writes beyond create.

## Progress

- Opened after independent Luna `APPROVE`, zero findings/caveats, for the outstanding-invitations read repository only.
- Existing `generateInviteToken()` returns a one-time plaintext token plus SHA-256 hash; this task accepts the hash field only. Existing POST route supplies validated role/expiry/label and remains unchanged.
- Added `create` to the server-only repository. It requires admin+, uses guard-derived account/user IDs, rejects owner/invalid roles and malformed hashes, binds inputs, persists only the supplied hash, and returns metadata without the hash. No route wiring or token generation changed.
- Focused Vitest passed 54/54; TypeScript, targeted ESLint (zero warnings), and Prettier passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic data, `NOBYPASSRLS`, network isolation, tmpfs and read-only mounts. It verified role/session enforcement, scope isolation, hash-only persistence, metadata projection, and transaction-local identity cleanup. Log: `../validation-postgres-account-invitation-create-f709b7d93f.log`.
- Same-model Luna read-only reviewer returned `APPROVE`, zero findings/caveats, limited to this repository slice. Reviewer made no edits and ran no tests.

## Next action

Continue with the next narrow H-DATA-003 account repository slice. Keep this task `in_progress` and the route unwired pending verified-session integration and least-privilege grant approval.
