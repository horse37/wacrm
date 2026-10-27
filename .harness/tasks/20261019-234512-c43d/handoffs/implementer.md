# Implementer handoff — PostgreSQL tag-list read repository

## Start state

- Task `20261019-234512-c43d`, status `in_progress`, H-DATA-003 phase 03.
- Repository root: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve every existing dirty/untracked file. PostgreSQL only in task-owned disposable Docker Desktop resources; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only read repository for `public.tags`, requiring the verified-account guard for any member role, transaction-local identity for RLS, and an explicit guard-derived `account_id` predicate. Return the existing `Tag` projection ordered by `created_at ASC` and stable `id ASC`.

Keep `contact_tags` assignments, UI/routes, tag writes, custom fields, Auth/session provider, schema/grants/RLS, and other data domains separate.

## Validation

Start with a failing focused Vitest. Run the repository/guard focused tests, TypeScript, targeted zero-warning ESLint, Prettier, fixture/script checks, `git diff --check`, and a synthetic forced-RLS PostgreSQL 16 integration in task-owned disposable Docker Desktop. Use `--network none`, tmpfs, read-only mounts, run-only generated passwords, no published ports or named volumes, runtime `NOBYPASSRLS`, and assert cleanup.

## Next action

The authorized independent same-model Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this tag-list repository slice. Keep this task `in_progress` and consumers unwired; continue with a separate read repository for contact-tag assignments.

## Boundaries

This task does not approve H-DATA-003 overall, consumer migration, H-SELF-002, H-DB-003, Supabase/Auth replacement, contact-tag reads/writes, mutations, permanent grants/RLS, Storage, Realtime, traffic, or production.

## Results

- TDD RED confirmed the module was absent. Added `src/lib/repositories/tag-list.ts` with verified-account scope, transaction-local identity, explicit parameterized `account_id`, existing `Tag` projection, and oldest-first ordering with an ID tie-break. Contact-tag assignments remain separate.
- Focused Vitest passed 13/13; TypeScript and targeted ESLint (`--max-warnings=0`) passed; Prettier check passed; PowerShell AST/fixture whitespace and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts/profiles/tags, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no-residual-resource check. Stable ordering, projection, viewer access, account isolation, empty result, no-session rejection, fail-closed missing-identity RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261019-234512-c43d/validation-postgres-tag-list-49051e4107.log`.
- No Supabase, consumers, Auth/session provider, tag assignments/writes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.
- Independent review checked branch/expected HEAD/task status, verified-account guard, transaction-local RLS identity, explicit account predicate and projection/order mapping, fixture/script, and final Docker evidence. Its approval is limited to this tag-list slice; H-DATA-003 overall remains unapproved.
