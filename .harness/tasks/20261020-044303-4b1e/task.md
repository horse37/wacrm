# Task — PostgreSQL message-reaction persistence

- id: `20261020-044303-4b1e`
- type: migration
- slug: `postgres-message-reaction-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for the authenticated agent reaction mirror: set or replace the actor's reaction, or remove only that actor's reaction.

## Context

`POST /api/whatsapp/react` calls the external provider first and then upserts or deletes `message_reactions`. Migration 017 scopes reaction writes to account members with at least agent role through the related message and conversation. The new repository handles only the local database persistence after provider success; it must not call the provider. Use disposable PostgreSQL in Docker Desktop; never Supabase.

## In scope

- Require a verified session and at least agent account role; use the session user as `actor_id` and hardcode `actor_type = 'agent'`.
- Validate the internal message UUID and emoji string; distinguish an inaccessible/missing message from a message without a provider message ID.
- In one transaction set transaction-local RLS identity, verify the message and its conversation belong to the verified account and the conversation creator profile is consistent, then persist the reaction.
- For nonempty emoji, upsert by `(message_id, actor_type, actor_id)`, updating only the denormalized conversation ID and emoji. For empty emoji, delete only that actor's agent reaction; never touch customer reactions.
- Prove forced RLS, `NOBYPASSRLS`, minimum grants, role/account isolation, no-provider-ID handling, upsert replacement, actor-scoped deletion, customer-reaction preservation, concurrency, identity cleanup, and disposable-resource cleanup in Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, provider/Evolution/Meta calls, external network, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Writes only to task-owned synthetic Docker data. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with a failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `--network none`, tmpfs, read-only mounts, generated credentials, forced RLS, minimum privileges, concurrency, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Inspect and scope the next isolated PostgreSQL repository slice. Keep this route unwired and do not send provider reactions.

## Implementation and validation

- TDD RED confirmed the repository module was absent; focused Vitest passed 10/10. TypeScript and targeted ESLint with `--max-warnings=0` passed.
- Added an unwired server-only repository requiring verified agent-level account membership. It checks a delivered message and its conversation/creator account in one transaction, sets transaction-local identity, derives `actor_id` from the verified session, upserts only `actor_type = 'agent'`, and deletes only that actor's agent reaction when emoji is empty.
- Final disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS on accounts, profiles, conversations, messages, and reactions; `NOBYPASSRLS`; exact minimum column SELECT/INSERT/UPDATE and table DELETE grants; two-account isolation; missing provider-ID rejection; replacement and concurrent upserts; idempotent actor-only deletion; customer-reaction preservation; identity cleanup; synthetic data, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual resources. Evidence: `validation-postgres-message-reaction-persistence-aaa6561efc.log`.
- Earlier evidence is preserved: `1a6f6d56c6` records the initial missing SELECT privilege; `a41e28cb3a` captures the PostgreSQL 42501 permission detail; `115c8f9ccf` passed after adding the required `emoji` column SELECT grant while temporary failure diagnostics were present. The final `aaa6561efc` rerun passed after removing that temporary instrumentation. A PowerShell preflight regex interpolation error was corrected before any container was created and produced no task log.
- PowerShell AST and fixture-policy/grant checks passed in the final runner. Prettier check and `git diff --check` passed after the evidence update.
- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this unwired repository only. This does not approve route wiring or H-DATA-003/H-DB-003 overall.
- No route wiring, provider call, Supabase, real data/credentials, app traffic, production, commit, push, or deploy. Task stays `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
