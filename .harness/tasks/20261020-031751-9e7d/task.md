# Task — PostgreSQL account-scoped template send definition

- id: 20261020-031751-9e7d
- type: migration
- slug: postgres-template-send-definition
- roadmap: H-DATA-003, phase 03
- status: in_progress

## Goal

Add an unwired server-only PostgreSQL lookup for a message-template definition used by individual and broadcast send paths.

## Context

Earlier H-DATA-003 phase 03 template reads have slice-limited independent GPT-6 Luna approvals. Existing `/api/whatsapp/send` and `/api/whatsapp/broadcast` paths query by current account, template name, and language; keep both consumers unwired. Use PostgreSQL in disposable Docker Desktop only; never Supabase.

## In scope

- Preserve account/name/language lookup semantics, including default language `en_US` when omitted or empty; do not add a status filter absent from the existing reads.
- Require verified account membership, explicit account predicate, transaction-local `auth.uid()`, and creator profile/account consistency.
- Return null when missing; fail closed on ambiguous account-level duplicates. Return a minimal validated `MessageTemplate`-compatible send definition, omitting upload handles, Meta IDs, samples, and submission/error internals.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, actual message send, Meta calls, writes, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve existing local work. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks until APPROVE with zero findings/caveats. Keep task `in_progress` and consumers unwired.

## Next action

Implementation, focused validation, and disposable Docker Desktop PostgreSQL 16 integration are complete. TDD RED first confirmed the repository module was absent. Vitest passed 22/22; TypeScript, targeted ESLint (zero warnings), Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Forced-RLS Docker integration passed with runtime `NOBYPASSRLS`, exact minimum column grants, account/name/language predicates, creator consistency, default language, missing/ambiguous handling, minimal DTO, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual resources. Evidence: `validation-postgres-template-send-81e8e8dad8.log`. Independent review returned `APPROVE`, zero findings/caveats, for this slice only. Next: isolate the account-scoped template context read used by template lifecycle handlers. Keep consumers unwired and task `in_progress`.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/template-send-definition.ts` and focused tests. The unwired lookup uses the verified account, exact name/language, defaults an omitted/empty language to `en_US`, joins creator profile/account, and rejects ambiguous account-level matches. It returns only the validated fields required by the existing send builder; upload handles, sample values, Meta identifiers, status, and submission/error internals are excluded.
- TDD RED confirmed module absence. Focused Vitest passed 22/22; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed; PowerShell AST/fixture checks passed; `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, runtime `NOBYPASSRLS`, exact minimum column SELECT grants, account isolation, creator consistency, default language, null/missing/ambiguous behavior, minimal DTO, transaction-local identity cleanup, `--network none`, tmpfs, read-only mounts, synthetic data/generated credentials, and no residual task resources. Evidence: `validation-postgres-template-send-81e8e8dad8.log`.
- No send/API route wiring, actual sends, Meta calls, writes, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, application traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this template-send repository slice. H-DATA-003/H-DB-003 remain unapproved overall; harness task remains `in_progress`.
