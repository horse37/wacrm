# Task — PostgreSQL conversation list with contact projection

- id: `20261019-232347-6dee`
- type: migration
- slug: `postgres-conversation-list-contact-join`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add a server-only PostgreSQL read for the inbox conversation list, including its contact projection, with explicit verified-account scope.

## Context

H-DATA-003 prioritizes conversations/messages after profile/account and `whatsapp_config`. The account repositories, WhatsApp config read, and conversation message-history repository have independent Luna approvals limited to their slices. Existing Supabase-backed inbox consumers remain unwired pending H-SELF-002 and H-DB-003. PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.

## In scope

- Require verified account membership; preserve current list access for all account roles.
- Set the verified identity transaction-locally and query conversations joined to contacts, binding both account IDs to the guard-derived account.
- Return only fields represented by existing `Conversation` and `Contact` types, validate row shape, and safely reject malformed rows.
- Preserve the current descending `last_message_at` ordering, including PostgreSQL's null-first behavior for descending order.
- Focused unit tests and synthetic forced-RLS PostgreSQL Docker integration for account isolation, contact projection, ordering, empty results, and pooled identity cleanup.

## Out of scope

- Route/page wiring, Supabase, Auth/session provider or policy, Realtime, writes, contact CRUD/tags/custom fields, pagination, schema/migration changes, permanent grants/RLS, real data/credentials, existing Docker resources, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace checks, and `git diff --check`.
- Disposable PostgreSQL 16 Docker with synthetic accounts/profiles/contacts/conversations, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

The repository slice received same-model Luna `APPROVE`, zero findings, and zero caveats. Keep this task `in_progress` and consumers unwired; next H-DATA-003 slice is the contacts read repository.

## Boundaries

This slice does not approve H-DATA-003 overall, route/UI migration, H-SELF-002, H-DB-003, Auth/session, permanent RLS/grants, Realtime, Storage, traffic, or production.

## Implementation and validation

- TDD RED confirmed the new repository module was absent. Added `src/lib/repositories/conversation-list.ts`; `listConversations()` requires verified account membership for every role, sets identity transaction-locally, joins conversations to contacts, and binds the guard-derived account ID in both tenant predicates. It maps only existing `Conversation`/`Contact` fields, validates IDs/status/timestamps/counts and joined account/contact consistency, and returns the existing descending `last_message_at` order with nulls first.
- Focused Vitest passed 19/19 across the new list repository, message-history repository, and account guard. TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts/profiles/contacts/conversations, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and `PG_POOL_MAX=1`. It verified viewer projection, account isolation, null-first descending order, generated phone normalization, nullable unread count, empty account, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-232347-6dee/validation-postgres-conversation-list-c8329caac5.log`; no task resources remain.
- No route/page/Realtime wiring, contact writes/tags/custom fields, pagination, migrations, permanent grants/RLS, Supabase, Auth/session changes, real data/credentials, application traffic, or production were touched.
- Final frozen-tree Gitleaks 8.21.2 directory scan ran in Docker with `--network none` and a read-only repository mount; exit 0, `no leaks found` (3m17s). The container used `--rm`; no task resource remains.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings, and zero caveats for this repository slice. The reviewer checked branch/HEAD/task state, verified account scope on both joined tables, test/fixture and final Docker evidence. Review was read-only and ran no tests.
- Approval is limited to conversation-list/contact-projection read. It does not approve H-DATA-003 overall or any out-of-scope consumer/runtime/production work.
