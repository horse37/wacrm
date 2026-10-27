# Task — PostgreSQL template-editor detail read

- id: `20261020-025523-9f3a`
- type: migration
- slug: `postgres-template-editor-detail-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository to load the fields needed to prefill one template-editor form.

## Scope

- Validate template UUID; require verified account membership and transaction-local `auth.uid()`; return safe not-found for absent/out-of-scope rows.
- Preserve Settings → Templates per-user behavior; scope by verified account/user and require creator profile to match both.
- Return only `id`, `name`, `category`, nullable `language`, nullable `header_type`, nullable `header_content`, nullable `header_media_url`, `body_text`, nullable `footer_text`, nullable `buttons`, and nullable `sample_values`.
- Validate UUID, categories, nullable strings, header type, button variants, sample-value arrays, and minimal DTO; omit `header_handle`, Meta IDs, status/error details, and unrelated fields.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, create/update/delete, Meta calls/sync, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all preexisting local work. Consumers stay unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact minimum SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress`.

## Next action

Implementation and focused validation are complete. TDD RED first confirmed the repository module was absent. Added an unwired server-only detail read with verified account/user predicates, creator profile consistency, transaction-local identity, safe not-found handling, and a minimal validated editor DTO. Vitest passed 18/18; TypeScript, targeted ESLint (zero warnings), Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, runtime `NOBYPASSRLS`, exact minimum column grants, account/user/creator isolation, null legacy fields, JSON validation, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and no residual task resources. Evidence: `validation-postgres-template-editor-9fea5ff4c0.log`. Next: obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected validation until APPROVE with zero findings/caveats. Keep task `in_progress`, consumers unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/template-editor-detail.ts` and focused tests. The repository returns only editor form fields; button variants/sample-value arrays are validated and projected, while upload handle and Meta/error fields remain excluded.
- TDD RED confirmed module absence. Focused Vitest passed 18/18; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed; PowerShell AST/fixture checks passed; `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, a `NOBYPASSRLS` runtime role, exact minimum column grants, per-user/account/creator isolation, nullable legacy values, strict button/sample DTO checks, transaction-local identity cleanup, `--network none`, tmpfs, read-only repository mounts, synthetic values/generated credentials, and no residual task resources. Evidence: `validation-postgres-template-editor-9fea5ff4c0.log`.
- No consumer wiring, writes, Meta calls, Auth/session replacement, schema/grant/RLS changes, Supabase, real data/credentials, application traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, with zero findings and zero caveats, limited to this template-editor detail repository slice. H-DATA-003/H-DB-003 remain unapproved overall; harness task remains `in_progress`.
