# Task — PostgreSQL template-manager catalog read

- id: `20261020-025018-6cda`
- type: migration
- slug: `postgres-template-manager-catalog-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for the template cards displayed in Settings → Templates.

## Scope

- Require verified account membership and set `auth.uid()` identity transaction-locally.
- Preserve the current screen's per-user list: restrict templates to the verified user and account; require the creator profile to match both.
- Keep unbounded newest-first order, with a stable UUID tie-break.
- Return only card/action fields: `id`, `name`, `category`, `status`, nullable `language`, `quality_score`, `body_text`, nullable `footer_text`, `rejection_reason`, `submission_error`, and `meta_template_id`. Validate UUID, strings, enums, and nullable values.
- Add focused Vitest and disposable Docker Desktop PostgreSQL 16 forced-RLS integration evidence.

## Out of scope

No UI/API wiring, editor-form detail fields, create/update/delete, sync/Meta calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve preexisting local work. Consumers stay unwired pending H-SELF-002/H-DB-003. This slice does not approve H-DATA-003 or H-DB-003 overall.

## Validation

Start with TDD RED. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, forced RLS, exact minimum SELECT grants, `--network none`, tmpfs, read-only repository mounts, synthetic data/credentials, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task `in_progress`.

## Next action

Implementation, focused validation, and independent review are complete. TDD RED confirmed module absence; focused Vitest passed 13/13, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture forced-RLS/minimum-grant checks, and `git diff --check` passed. The first Docker fixture setup stopped before integration because one synthetic VALUES row had a missing NULL; the seed was corrected. Final disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `validation-postgres-template-manager-f35553be3a.log`. Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice only. Next: separate template-editor detail read; keep task `in_progress`, consumers unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Worktree validation — 2026-10-20

- Added `src/lib/repositories/template-manager-catalog.ts`, preserving the current per-user list inside verified account scope with transaction-local identity and creator/profile consistency. It returns only validated card/action fields and preserves unbounded newest-first order with UUID tie-break.
- Added 13 focused unit tests. `npm test -- src/lib/repositories/template-manager-catalog.test.ts` passed 13/13; `npm run typecheck`, targeted ESLint with zero warnings, Prettier check, PowerShell AST/fixture forced-RLS/minimum-grant checks, and `git diff --check` passed.
- The first Docker fixture setup stopped before integration because the synthetic seed had a missing NULL in one VALUES row; that fixture row was corrected. Final disposable Docker Desktop PostgreSQL 16 proof passed with runtime `NOBYPASSRLS`, forced RLS on accounts/profiles/templates, exact minimum column SELECT grants, per-user/account isolation, owner/agent/viewer checks, creator join, stable unbounded order, nullable legacy fields, safe DTO, `--network none`, tmpfs, read-only mounts, generated credentials, no published ports/named volumes, and cleanup verification. Evidence: `validation-postgres-template-manager-f35553be3a.log`.
- No UI/API wiring, editor detail read, create/update/delete, Meta calls/sync, Supabase, Auth/session replacement, schema/grant/RLS changes, real data/credentials, application traffic, production, commit, push, or deploy. Consumer remains unwired; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero actionable findings, and zero caveats, limited to this template-manager catalog slice. H-DATA-003/H-DB-003 remain unapproved overall.
