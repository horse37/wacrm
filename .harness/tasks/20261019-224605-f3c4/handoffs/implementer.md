# Implementer handoff — PostgreSQL account ownership transfer repository

## Start state

- Task: `20261019-224605-f3c4`, `postgres-account-ownership-transfer-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only the server-side wrapper for existing `public.transfer_account_ownership(uuid)`. Require the verified owner, validate and preflight the target in the guard-derived account, reject self/missing/cross-account targets without revealing cross-account existence, set verified identity transaction-locally, and call the RPC with a bound UUID. Migration 018 owns the atomic role and owner-pointer updates. Leave route, RPC source, grants, schema, RLS and all other behavior untouched.

## Progress

- Opened after independent same-model Luna approvals for the account member-role and member-removal repository slices; each approval is limited to its own slice.
- Reviewed existing route contract: POST returns `{ ok: true }` after the RPC succeeds. Inspect the exact migration 018 body and adjacent repository patterns before coding.
- Docker proof must use synthetic data, a task-owned PostgreSQL 16 container with `--network none`, tmpfs, a read-only repository mount, no ports or volumes, and complete cleanup. Do not interact with existing containers.
- Added server-only `transferTo`; it requires owner, validates/self-checks and scopes the target, sets verified identity transaction-locally, calls the existing RPC with a bound UUID, and leaves role/pointer changes to the RPC. Route and migration remain unchanged.
- TDD RED failed because the repository module was absent; focused Vitest passed 61/61 across nine account repository/guard files. TypeScript, targeted ESLint with zero warnings, and final Prettier check passed.
- Disposable PostgreSQL 16 integration passed; log `../validation-postgres-account-ownership-transfer-3576300ce0.log`. It verifies atomic demotion/promotion, owner pointer, account isolation, denial cases, identity cleanup, and container cleanup. `git diff --check` and untracked whitespace checks passed.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this slice. Keep task `in_progress` and route unwired; next is a separate PostgreSQL-only invitation preview repository slice.
