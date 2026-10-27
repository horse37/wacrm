# Task — PostgreSQL conversation message history repository

- id: `20261019-231700-9795`
- type: migration
- slug: `postgres-conversation-message-history-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add a server-only PostgreSQL read for message history in one conversation, explicitly scoped to the verified account.

## Context

H-DATA-003 prioritizes conversations/messages after profile/account and `whatsapp_config`. The WhatsApp connection-read repository slice received independent Luna `APPROVE`, limited to that slice. Existing inbox and message-thread consumers remain unwired pending H-SELF-002 and H-DB-003. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.

## In scope

- Require a verified account membership; preserve current read access for all account roles.
- Validate conversation UUID, set verified identity transaction-locally, and query only messages whose parent conversation belongs to the guard-derived account.
- Return the fields represented by the existing `Message` type, ordered by `created_at` ascending; safely reject malformed rows.
- Focused unit tests and synthetic forced-RLS PostgreSQL Docker integration for account isolation, order, empty results, and pooled identity cleanup.

## Out of scope

- Route/page wiring, Supabase, Auth/session implementation, Realtime, message writes/edits/deletes, reactions, contacts/conversation repositories, media storage, migrations, permanent grants/RLS, real data/credentials, existing Docker resources, app traffic, production, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, and `git diff --check`.
- Disposable PostgreSQL 16 Docker with synthetic accounts/conversations/messages, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual task resources.

## Next action

Independent same-model Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this repository slice. The task remains `in_progress`; the next H-DATA-003 slice is a separate conversation-list/contact-join repository. Keep consumers unwired.

## Implementation and validation

- Added `src/lib/repositories/conversation-messages.ts`. `listForConversation()` requires verified account membership, validates the conversation UUID, sets identity transaction-locally, joins messages to conversations, binds conversation and guard-derived account IDs, and orders by `created_at ASC`. It maps only fields from the existing `Message` contract, converts timestamps to ISO, and rejects malformed rows safely. Missing and cross-account conversations return an empty list.
- TDD RED confirmed the repository module was absent. Focused Vitest passed 14/14 across the new repository and account-guard tests. TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, PowerShell AST parsing, SQL/PowerShell whitespace checks, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts/conversations/messages, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and `PG_POOL_MAX=1`. It verified viewer reads, ascending history including reply/interactive fields, cross-account denial, missing/empty history, absent session, fail-closed RLS, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-231700-9795/validation-postgres-conversation-messages-f91dc34b13.log`; no task resources remain.
- No route, page, Realtime, message write/edit/delete, migration, permanent grant, or Supabase use changed. H-SELF-002, H-DB-003, media/storage, traffic, and production remain out of scope.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings, and zero caveats, limited to this repository slice.
- Reviewer checked branch/HEAD/task status, verified membership, bound conversation and account scope, fixed `Message` mapping, RLS fixture, focused tests, and final Docker evidence. Review was read-only and ran no tests.
- This does not approve H-DATA-003 overall, route wiring, Auth/session, permanent RLS/grants, Realtime, Storage, traffic, or production.
