# Task — PostgreSQL template lifecycle configuration read

- id: 20261020-033030-f49a
- type: migration
- slug: postgres-template-lifecycle-config-read
- roadmap: H-DATA-003, phase 03
- status: in_progress

## Goal

Add an unwired server-only PostgreSQL read of the minimal WhatsApp configuration fields needed by template lifecycle handlers.

## Context

The existing generic WhatsApp config repository omits waba_id. The template lifecycle handlers currently read the full config row but consume only encrypted access_token and, for delete, waba_id. PostgreSQL in disposable Docker Desktop only; never use Supabase.

## In scope

- Expose separate edit/delete context DTOs: opaque encrypted access token; delete also includes nullable WABA ID.
- Require verified account membership, explicit guarded account predicate, transaction-local RLS identity, parameterized SQL, and null when no row exists.
- Validate row shape and fail closed on duplicate account rows.
- Prove exact minimum column grants and synthetic forced-RLS isolation in Docker PostgreSQL 16.

## Out of scope

No route/UI wiring, token decryption, Meta calls, writes, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve existing work. Keep this task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, git diff --check, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with NOBYPASSRLS, exact minimum SELECT grants, --network none, tmpfs, read-only mounts, synthetic opaque values/generated credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate until APPROVE with zero findings/caveats.

## Implementation and validation

- Added a dedicated server-only repository with separate edit/delete context reads. Edit projects only opaque encrypted access_token; delete projects encrypted access_token and nullable waba_id.
- Both reads require verified account membership, use the guard-derived account ID as a bound predicate, set transaction-local identity, return null when absent, and fail closed on duplicates or malformed fields. The token is neither decrypted nor logged.
- TDD RED confirmed module absence. Focused Vitest passed 9/9; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and git diff --check passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with NOBYPASSRLS and exact minimum column grants. Synthetic cross-account fixtures, --network none, tmpfs, read-only mounts, generated credentials, and cleanup were verified. Final evidence: validation-postgres-template-lifecycle-config-43b496b6f9.log.
- No route/UI wiring, Meta calls, writes, Supabase, real credentials/data, application traffic, production, commit, push, or deploy.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero findings and zero caveats, limited to this repository slice. This does not approve route wiring or H-DATA-003/H-DB-003 overall.

## Next action

Next task `20261020-033829-58ee` isolates the template-sync account/name/language match read. Keep lifecycle consumers unwired, this task in_progress, and H-DATA-003/H-DB-003 unapproved overall.
