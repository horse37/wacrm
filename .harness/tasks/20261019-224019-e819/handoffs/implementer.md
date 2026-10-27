# Implementer handoff — PostgreSQL account member removal repository

## Start state

- Task: `20261019-224019-e819`, `postgres-account-member-removal-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only the server-side wrapper for existing `public.remove_account_member(uuid)`. Require admin+, validate and preflight the target within the guard-derived account, reject self/owner/missing targets, hide cross-account existence, set verified session identity transaction-locally, call the RPC with a bound UUID, and return its new personal account UUID. Migration 018 owns the account creation and profile reassignment. Leave route, RPC source, grants, schema, RLS and all other behavior untouched.

## Progress

- Opened after same-model Luna independently approved task `20261019-222944-b638`, limited to the member-role repository slice.
- Reviewed the existing DELETE route contract: it calls migration 018's RPC and returns `newPersonalAccountId`. Adjacent repository patterns informed the wrapper; no route changes were made.
- Docker proof must use synthetic data, a task-owned PostgreSQL 16 container with `--network none`, tmpfs, a read-only repository mount, no ports or volumes, and complete cleanup. Do not interact with existing containers.
- Added `removeMember`. It validates and scopes the target, rejects self/owner/missing targets, sets transaction-local verified identity, calls the existing RPC with a bound UUID, and validates/returns the new account UUID. The route and migration remain unchanged.
- TDD RED failed because the module was absent; focused Vitest passed 53/53 across eight account repository/guard files. TypeScript, targeted ESLint with zero warnings, and final Prettier check passed.
- Disposable PostgreSQL 16 integration passed; log `../validation-postgres-account-member-removal-bafbf5b07b.log`. Synthetic data confirmed account/profile reassignment, restrictions, identity cleanup, and full resource cleanup. `git diff --check` and untracked whitespace checks passed.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this slice. Keep task `in_progress` and route unwired; next is a separately scoped PostgreSQL repository slice for ownership transfer.
