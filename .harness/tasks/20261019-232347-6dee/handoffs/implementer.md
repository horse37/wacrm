# Implementer handoff — PostgreSQL conversation list with contact projection

## Start state

- Task `20261019-232347-6dee`, status `in_progress`, H-DATA-003 phase 03.
- Repository root is the checked-out Git root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- The user's alternate path `C:\Sistemas\zapcrm\wacrm` is absent in this session. Preserve the existing checkout and all pre-existing dirty/untracked work.
- PostgreSQL only in task-owned disposable Docker Desktop resources. No Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one server-only method to list conversations for the guard-verified account, joined to the required contact projection. Preserve all-role read access and the current `last_message_at DESC` ordering. Bind the verified account ID in both conversation and contact scope, use transaction-local identity, validate row fields, and return only fields from existing `Conversation` and `Contact` types.

Do not wire inbox/deep-link consumers or change contact writes, Realtime, pagination, migrations, permanent grants/RLS, Auth/session, or other domains.

## Validation

Start with a failing Vitest. Then run focused unit/guard tests, TypeScript, targeted ESLint with zero warnings, Prettier check, fixture/PowerShell checks, `git diff --check`, and synthetic PG16 forced-RLS integration in Docker Desktop. Use runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only repo mounts, generated run-only passwords, no ports/named volumes, and assert cleanup.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice. Keep the task in progress and consumers unwired; the next H-DATA-003 slice is the contacts read repository.

## Evidence and limits

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/conversation-list.ts` with verified membership, transaction-local RLS identity, explicit conversation/contact account predicates, fixed field mapping, validation, and preserved descending `last_message_at` order.
- Focused Vitest passed 19/19 across this repository, message history, and the account guard. TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- PostgreSQL 16 disposable Docker passed with synthetic data, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/volumes, and `PG_POOL_MAX=1`. It verified viewer projection, tenant isolation, null-first descending order, phone normalization, null unread count, empty account, and pooled identity cleanup. Evidence: `.harness/tasks/20261019-232347-6dee/validation-postgres-conversation-list-c8329caac5.log`; cleanup reported no residual task resources.
- Earlier account/profile, WhatsApp config, and message-history slices have limited Luna approvals; H-DATA-003 overall remains unapproved. H-SELF-002, H-DB-003, Supabase, Auth, Storage, Realtime, app wiring/traffic, and production remain out of scope.
- Final frozen-tree Gitleaks 8.21.2 directory scan ran in Docker with `--network none` and a read-only mount; exit 0, `no leaks found` (3m17s). The `--rm` container left no task resource.
- Luna confirmed `main`, the expected HEAD, task `in_progress`, account binding for both joined tables, and consistency of the synthetic fixture/log with reported validation. Review was read-only and ran no tests. Approval is limited to this repository slice.
