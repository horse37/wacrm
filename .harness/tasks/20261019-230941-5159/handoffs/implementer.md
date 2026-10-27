# Implementer handoff — PostgreSQL WhatsApp config read repository

## Start state

- Task `20261019-230941-5159`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve pre-existing dirty and untracked work. No commit, push, deploy, reset, clean, rebase, or branch change.
- PostgreSQL only in task-owned disposable Docker Desktop resources. No Supabase.

## Scope

Implement only a server-only read wrapper for current-account `whatsapp_config` connection fields. Require verified membership, set `auth.uid()` identity transaction-locally, scope SQL to the guard-derived account, select only the phone number ID, encrypted access token, and connection status, and return no row as `null`.

Do not wire routes/pages, implement Auth/session, call Meta, decrypt tokens, write/delete config, edit migrations or grants/RLS, or touch other WhatsApp services. Existing route and caller behavior remain unchanged.

## Validation

Focused Vitest and synthetic forced-RLS PostgreSQL 16 Docker proof. Use `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/volumes, synthetic values only, exact evidence log, and cleanup assertion. Run TypeScript, targeted zero-warning ESLint, Prettier, and diff check.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this repository slice. Continue with the next H-DATA-003 priority: conversations/messages. Keep this task `in_progress` and the repository unwired; H-SELF-002, H-DB-003, and overall HARNESS approval remain open.

## Implementation and evidence

- Added `src/lib/repositories/whatsapp-config.ts`; it requires verified membership for any account role, sets identity transaction-locally, scopes by guard-derived account ID, selects only phone ID/encrypted token/status, returns `null` when absent, and safely validates row shape/status. It never decrypts or logs token material.
- Unit tests cover missing session, viewer access, bound account scope, selected-column boundary, absent config, duplicate rows, invalid status/token, and safe DB errors. Vitest passed 15/15 including the PostgreSQL account-guard tests; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST, and diff checks passed.
- PostgreSQL 16 integration passed with synthetic fixtures, forced RLS, a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no ports/volumes, and `PG_POOL_MAX=1`. Viewer access, account isolation, missing config/session, fail-closed RLS, and pool identity cleanup passed. Evidence: `../validation-postgres-whatsapp-config-2f4803ec0a.log`; no task containers remain.
- Route/page and Meta calls remain unwired. No Supabase, token decryption, config write/delete, migration, or permanent grants changed. No commit, push, or deploy.

## Independent review

- Luna returned `APPROVE`, zero findings and caveats, limited to this read-only repository slice. It checked branch/HEAD/task status, account guard/scope, identity GUC, selected columns, RLS fixture and final Docker log. Review was read-only.
- H-SELF-002, H-DB-003, route wiring, Meta, Storage, Realtime, production and overall HARNESS approval remain open/out of scope.
