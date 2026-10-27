# Implementer handoff — PostgreSQL conversation message history repository

## Start state

- Task `20261019-231700-9795`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve pre-existing dirty/untracked work. No commit, push, deploy, reset, clean, rebase, or branch change.
- PostgreSQL only in task-owned disposable Docker Desktop resources. No Supabase.

## Scope

Implement one server-only message-history read method. Require verified account membership, transaction-locally set the verified identity, join messages to conversations, bind both the requested conversation ID and guard-derived account ID, return existing `Message` fields in ascending creation order, and treat a cross-account or missing conversation as an empty result.

Do not wire inbox/message-thread consumers or change message writes, Realtime, reactions, media/storage, migrations, permanent grants/RLS, Auth/session, or other domains.

## Validation

Focused Vitest plus synthetic forced-RLS PostgreSQL 16 Docker integration. Use `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/volumes, synthetic-only data, exact evidence log, and cleanup assertion. Run TypeScript, targeted zero-warning ESLint, Prettier, and diff checks.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this repository slice. This task remains `in_progress`. Continue with the separate conversation-list/contact-join read slice. Keep consumers unwired; H-SELF-002, H-DB-003, and overall HARNESS approval remain open.

## Implementation and evidence

- Added `src/lib/repositories/conversation-messages.ts`. It requires verified membership, validates UUID input, transaction-locally sets identity, joins messages to conversations, scopes by conversation ID and guard-derived account ID, and returns fixed `Message` fields in ascending creation order. Timestamp and enum fields are validated; no rows returns an empty array.
- TDD RED confirmed the repository module was absent. Vitest passed 14/14 including account-guard tests. TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST, SQL/PowerShell whitespace, and diff checks passed.
- PostgreSQL 16 disposable Docker proof passed with synthetic data, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/volumes, and `PG_POOL_MAX=1`. Viewer access, order, cross-account denial, empty/missing history, missing session, fail-closed RLS, and pooled identity cleanup passed. Evidence: `../validation-postgres-conversation-messages-f91dc34b13.log`; no task containers remain.
- No route/page, Realtime, message mutation/storage, Supabase, migration, or permanent grant changed. No commit, push, or deploy.

## Independent review

- Luna returned `APPROVE`, zero findings and caveats, limited to this message-history slice. It verified main/HEAD/task state, account guard and bound account scope, fixed field mapping, fixture/test evidence, and final Docker log. Review was read-only.
- H-DATA-003 overall, consumers, Auth/session, permanent RLS/grants, Realtime, storage, traffic, and production remain open/out of scope.
