# Task — PostgreSQL message-reaction target context

- id: `20261020-045346-9a2d`
- type: `migration`
- slug: `postgres-message-reaction-target`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository to resolve the authenticated agent's message-reaction target and contact phone for the existing outbound operation.

## Context

The existing `/api/whatsapp/react` handler reads the message, account conversation, and contact phone through Supabase before calling Meta. The approved reaction-persistence repository covers only the later local write. A PostgreSQL WhatsApp-config repository already exists. Use Docker Desktop PostgreSQL only; never Supabase.

## In scope

- Require a verified session with at least agent role and derive account/user identity from PostgreSQL membership.
- In one transaction set transaction-local RLS identity and return only the provider message ID and contact phone for a message visible in the verified account, requiring conversation creator/account consistency.
- Validate the internal message UUID; preserve safe missing-message, unsent-message, and missing-phone outcomes.
- Prove account isolation, forced RLS, exact minimum grants, and synthetic-only behavior in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, provider or network calls, config/token reads, Supabase, Auth/session replacement, schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all existing local changes. Keep this task in progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- Focused Vitest begins red and then passes; run TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run a task-owned forced-RLS PostgreSQL 16 integration in Docker Desktop with runtime `NOBYPASSRLS`, exact minimum column grants, synthetic values, generated credentials, `--network none`, tmpfs, read-only mounts, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, zero caveats for this repository slice.

## Next action

Inspect and scope the next isolated PostgreSQL-backed message-reaction slice. Keep this route unwired.

## Implementation and validation

- TDD RED confirmed the repository was absent; focused Vitest passed 11/11. TypeScript, targeted ESLint with `--max-warnings=0`, Prettier, and `git diff --check` passed.
- Added an unwired server-only query requiring a verified agent account member. It uses transaction-local RLS identity and returns only the provider message ID and contact phone after checking message visibility, conversation account, contact account, and creator profile consistency.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS on accounts, profiles, contacts, conversations, and messages; runtime `NOBYPASSRLS`; exact column grants and no table-level grants; agent authorization; cross-account and creator mismatch isolation; unsent-message and missing-phone outcomes; identity cleanup; synthetic fixtures; `--network none`; tmpfs; read-only mounts; generated credentials; and no residual containers. Evidence: `validation-postgres-message-reaction-target-fbb51f4027.log`.
- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this target-context repository only. Route/provider behavior and H-DATA-003/H-DB-003 overall remain unapproved.
- Route remains unwired. No provider calls, Supabase, real credentials/data, application traffic, production, commit, push, or deploy occurred. Task stays `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
