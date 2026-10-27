# Implementer handoff — PostgreSQL invitation preview repository

## Start state

- Task: `20261019-225101-d76a`, `postgres-invitation-preview-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only a server-side read wrapper around existing `public.peek_invitation(text)`. Accept a SHA-256 digest, never plaintext. Bind it as a parameter, validate and reconstruct only the published fixed response fields, and preserve not-found/expired/used reasons. Leave route, rate limiting, token hashing, schema, migration, and grants unchanged.

## Progress

- Opened after independent same-model Luna approvals for the account member-removal and ownership-transfer repository slices; each approval is limited to its own slice.
- Added `src/lib/repositories/invitation-preview.ts` and focused tests. `peekByTokenHash` accepts only a 64-character hexadecimal digest, normalizes case, uses a bound call to `public.peek_invitation($1::text)`, validates the fixed JSON contract, and discards extra response properties. Malformed hashes return `not_found` without database access. The existing GET route hashes plaintext before the repository boundary; it remains unwired.
- TDD RED failed because the module was absent. Invitation tests passed 11/11; the broader account repository/guard suite passed 72/72 across 10 files. TypeScript, targeted ESLint with zero warnings, Prettier, diff check, and SQL/PowerShell whitespace checks passed.
- Disposable PostgreSQL 16 Docker proof passed with synthetic invitations, runtime `NOBYPASSRLS`, no direct SELECT grants on accounts or invitations, `--network none`, tmpfs, read-only mounts, no ports or volumes. It verified safe success/failure results and malformed hash handling; task resources were removed. Evidence: `.harness/tasks/20261019-225101-d76a/validation-postgres-invitation-preview-2133f41267.log`.
- No migration, route, hash utility, rate limit, schema, or permanent grants were changed. No Supabase service or existing Docker resource was used.

## Next action

Proceed to a separate PostgreSQL invitation-redemption repository slice. Keep this task `in_progress` and route unwired.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this preview repository slice. It confirmed branch/HEAD/task state, digest-only parameter binding, response sanitization, fixture fidelity, and Docker evidence; the review made no edits and ran no tests.
- This does not approve route wiring, Auth/session integration, redemption, H-DB-003, Storage, Realtime, application traffic, production, or the overall HARNESS task.
