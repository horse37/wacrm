# Task — PostgreSQL approved broadcast-template read

- id: `20261020-024421-82a1`
- type: migration
- slug: `postgres-approved-broadcast-template-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for the approved message-template cards shown in the broadcast composer.

## Scope

- Require verified account membership and set `auth.uid()` identity transaction-locally.
- Read only `APPROVED` templates belonging to the verified account, with creator profile tied to that same account.
- Preserve legacy newest-first ordering and return only `id`, `name`, `category`, nullable `language`, and `body_text`; validate UUID, strings, category, and nullable language.
- Keep the query unbounded, matching current broadcast-composer behavior.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, template-picker/settings/inbox migration, writes, Meta calls/sync, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all preexisting local work. Consumers stay unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact minimum SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress`.

## Next action

Implementation, focused validation, and independent review are complete. TDD RED confirmed the repository module was absent; focused Vitest passed 10/10, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture forced-RLS/minimum-grant checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `validation-postgres-approved-template-172e15f932.log`. Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice only. Next: separate template-manager catalog read; keep task `in_progress`, consumers unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/approved-broadcast-templates.ts` with a server-only, account-scoped, approved-only read and five-field validated DTO. It preserves unbounded newest-first order with UUID tie-break and requires the template creator profile to match the verified account.
- Added ten focused unit tests and synthetic forced-RLS fixture/integration scripts. `npm test -- src/lib/repositories/approved-broadcast-templates.test.ts` passed 10/10; `npm run typecheck`, targeted `eslint --max-warnings=0`, Prettier check, PowerShell AST/fixture checks, and `git diff --check` passed.
- Final disposable Docker Desktop PostgreSQL 16 proof passed with runtime `NOBYPASSRLS`, forced RLS on accounts/profiles/templates, exact minimum column SELECT grants, owner/agent/viewer account isolation, creator consistency, approved-only filtering, stable unbounded ordering, nullable language, safe DTO, `--network none`, tmpfs, read-only mounts, generated credentials, no published ports/named volumes, and cleanup verification. Evidence: `validation-postgres-approved-template-172e15f932.log`.
- No UI/API wiring, settings/inbox migration, writes, Meta calls/sync, Supabase, Auth/session replacement, schema/grant/RLS changes, real data/credentials, application traffic, production, commit, push, or deploy. Consumer remains unwired; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero actionable findings, and zero caveats, limited to this approved-broadcast-template repository slice. H-DATA-003/H-DB-003 remain unapproved overall.
