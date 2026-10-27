# Task — PostgreSQL template delete persistence

- id: `20261020-043521-9f8c`
- type: migration
- slug: `postgres-template-delete-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository that deletes one template row after the existing lifecycle handler has decided provider work is complete or unnecessary.

## Context

The current `DELETE /api/whatsapp/templates/[id]` handler checks account ownership, optionally deletes remotely, then deletes the local row. Migration 017 grants template deletion only to account admins. The repository must preserve account isolation and verified authorization; it performs only the final local delete. Use disposable PostgreSQL in Docker Desktop; never Supabase.

## In scope

- Require a verified session and admin account role.
- Validate the template UUID before opening the delete transaction.
- Set transaction-local RLS identity and delete only the requested ID in the verified account.
- Require the template creator profile to remain consistent with the same account; fail closed on malformed or unexpected returned rows.
- Return no template content; preserve not-found behavior for absent or cross-account IDs.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimum grants, account/creator isolation, deletion outcome, identity cleanup, and cleanup in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Meta/provider calls, external network, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Writes only to task-owned synthetic Docker data. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with a failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `--network none`, tmpfs, read-only mounts, generated credentials, forced RLS, minimum privileges, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent; focused Vitest passed 8/8. TypeScript and targeted ESLint with `--max-warnings=0` passed.
- Added an unwired server-only delete repository. It requires verified admin membership, validates the UUID, sets transaction-local identity, scopes the parameterized DELETE to account and creator profile, returns no template content, and fails closed for missing, duplicate, or malformed results.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, `NOBYPASSRLS`, exact minimum SELECT-column and DELETE grants, admin/owner authorization, account and creator isolation, missing/cross-account behavior, competing deletes, identity cleanup, synthetic-only data, `--network none`, tmpfs, read-only mounts, and no residual resources. Evidence: `validation-postgres-template-delete-persistence-814bca45cf.log`.
- PowerShell AST and fixture-policy/grant checks passed inside the integration runner. Prettier check passed for all changed formatted sources/records; `git diff --check` passed.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this unwired repository slice. The reviewer made no edits. Evidence is recorded in `validation-postgres-template-delete-persistence-814bca45cf.log`.
- No route wiring, Meta call, Supabase, real data/credentials, app traffic, production, commit, push, or deploy. Task stays `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Proceed to `postgres-message-reaction-persistence`, isolating the local agent-reaction mirror behind the PostgreSQL repository. Keep the route unwired and do not send provider reactions; use Docker Desktop PostgreSQL only, never Supabase.
