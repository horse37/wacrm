# Task — PostgreSQL template lifecycle context read

- id: 20261020-032314-a83c
- type: migration
- slug: postgres-template-lifecycle-context-read
- roadmap: H-DATA-003, phase 03
- status: in_progress

## Goal

Add an unwired server-only PostgreSQL read for the minimal existing-template context needed by the lifecycle PATCH and DELETE handlers.

## Context

H-DATA-003 phase 03. Previous template repository slices have slice-limited independent GPT-6 Luna approvals. Use PostgreSQL in disposable Docker Desktop only; never use Supabase.

## In scope

- Preserve verified account-member lookup by template UUID and creator profile/account consistency.
- Provide separate minimal edit and delete context DTOs using only fields consumed by each existing handler.
- Use transaction-local RLS identity, account predicates, parameterized SQL, validated inputs/rows, and null for missing or out-of-account rows.
- Focused Vitest and disposable PostgreSQL 16 Docker Desktop forced-RLS integration.

## Out of scope

No route/UI wiring, Meta calls, writes, Auth/session replacement, schema/grant/RLS changes, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve existing local work. Keep this task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, git diff --check, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with NOBYPASSRLS, exact minimum SELECT grants, --network none, tmpfs, read-only mounts, synthetic records/generated credentials, and cleanup verification. Obtain a fresh independent GPT-6 Luna read-only review; remediate and repeat until APPROVE with zero findings/caveats.

## Implementation and validation

- Added an unwired server-only repository with separate minimal edit and delete context reads. Both bind the template UUID and verified account ID, join the creator profile/account, set transaction-local identity, and return null for missing/out-of-account rows.
- TDD RED confirmed the module was absent. Focused Vitest passed 7/7; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and git diff --check passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with runtime NOBYPASSRLS, exact minimum column grants, synthetic account/template/creator records, --network none, tmpfs, readonly mounts, generated credentials, and no residual task resources. Evidence: validation-postgres-template-lifecycle-69d6dc66c9.log.
- No routes, UI, writes, Meta calls, Supabase, real credentials/data, application traffic, production, commit, push, or deploy. Keep consumers unwired.

## Next action

Fresh independent GPT-6 Luna read-only review returned exact APPROVE, zero findings, and zero caveats for this slice only. Next: inspect and isolate the minimal account-scoped WhatsApp configuration read used by template lifecycle handlers. Keep this task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly APPROVE, with zero findings and zero caveats, limited to this template lifecycle context repository slice. No routes were wired. The HARNESS task remains in_progress; H-DATA-003/H-DB-003 remain unapproved overall.
