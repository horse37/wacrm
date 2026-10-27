# Implementer handoff — PostgreSQL contact-note read

## Start state

- Task `20261020-000914-5cc2`, status `in_progress`, H-DATA-003 phase 03.
- Repository root: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty/untracked work. PostgreSQL only in task-owned disposable Docker Desktop; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement `listForContact(contactId)` for `public.contact_notes`, requiring verified-account guard and transaction-local RLS identity. Validate UUID, explicitly scope note account, require the contact parent to have the same account, map only `ContactNote`, and order newest-first with stable ID tie-break.

Do not wire consumers or change note writes/deletes, schema, Auth/session provider, grants/RLS, or other repositories.

## Validation

Start with failing Vitest. Run focused repository/guard tests, TypeScript, targeted zero-warning ESLint, Prettier, fixture/script checks, `git diff --check`, and synthetic forced-RLS PostgreSQL 16 integration in disposable Docker Desktop. Use `--network none`, tmpfs, readonly mounts, generated run-only passwords, no ports/named volumes, runtime `NOBYPASSRLS`, and assert cleanup.

## Next action

Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this contact-note slice only. Keep task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the module was absent. Added server-only `src/lib/repositories/contact-note-list.ts` with verified-account guard, transaction-local identity, validated contact UUID, explicit note account scope, same-account contact join, existing `ContactNote` projection, and newest-first order with ID tie-break.
- Focused repository and account-guard Vitest passed 13/13; TypeScript, targeted zero-warning ESLint, and Prettier passed. PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual resources. Projection/order, account/contact isolation, mismatched-parent exclusion, viewer, empty result, invalid/no-session rejection, fail-closed RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261020-000914-5cc2/validation-postgres-contact-note-list-aa18e3cd0a.log`.
- No Supabase, consumer wiring, Auth/session changes, writes/deletes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.

## Independent review

- Fresh same-model GPT-6 Luna review returned exactly `APPROVE`, with zero findings/caveats. H-DATA-003 overall and consumer migration remain unapproved.

## Boundaries

This slice does not approve H-DATA-003 overall, consumer migration, H-SELF-002, H-DB-003, Supabase/Auth replacement, note writes/deletes, migrations, permanent grants/RLS, Storage, Realtime, traffic, or production.
