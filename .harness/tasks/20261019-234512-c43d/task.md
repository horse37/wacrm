# Task — PostgreSQL tag-list read repository

- id: `20261019-234512-c43d`
- type: `migration`
- slug: `postgres-tag-list-read-repository`

## Goal

Add a server-only PostgreSQL repository to list tags for the verified account.

## Context

H-DATA-003 phase 03. The contact-list repository slice received independent Luna APPROVE, limited to that slice. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase. Keep all consumers unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership for any account role and set transaction-local identity.
- Query `public.tags` with an explicit guard-derived `account_id` predicate and map the existing `Tag` projection.
- Preserve oldest-first creation order, with a stable ID tie-break.
- Add focused unit tests and synthetic forced-RLS PostgreSQL Docker integration for account isolation, projection, ordering, empty results, and pooled identity cleanup.

## Out of scope

- Contact-tag assignments, UI/route wiring, Supabase/Auth replacement, tag writes/import/delete, schema/grant/RLS changes, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic accounts/profiles/tags, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

The authorized independent same-model Luna read-only review returned APPROVE with zero findings and caveats for this tag-list repository slice only. Keep task `in_progress` and consumers unwired; continue with a separate read repository for contact-tag assignments.

## Results

- TDD RED confirmed the module was absent. Added `src/lib/repositories/tag-list.ts` with verified-account scope, transaction-local identity, explicit parameterized `account_id`, existing `Tag` projection, and `created_at ASC NULLS LAST, id ASC` ordering. Contact-tag assignments and consumers remain separate.
- Focused Vitest passed 13/13; TypeScript and targeted ESLint (`--max-warnings=0`) passed; Prettier check passed after formatting the test and integration script; PowerShell AST/fixture whitespace checks and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts/profiles/tags, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and cleanup assertion. It verified stable ordering, Tag projection, viewer access, account isolation, empty account, no-session rejection, missing-identity fail-closed RLS, and pooled identity cleanup. Evidence: `.harness/tasks/20261019-234512-c43d/validation-postgres-tag-list-49051e4107.log`.
- H-DATA-003 overall remains unapproved. No Supabase, consumer wiring, Auth/session changes, contact-tag assignment, writes, schema/grants/RLS changes, Storage, Realtime, real data, app traffic, or production were touched.

## Independent read-only review

- Same-model Luna reviewer returned `APPROVE`, zero findings, and zero caveats for this tag-list repository slice. The reviewer checked branch/HEAD/task state, the guard and transaction-local RLS identity, explicit account predicate and projection/order mapping, fixture/script and final Docker evidence. This does not approve H-DATA-003 overall, consumers, Auth/session, assignments/writes, grants/RLS, traffic, or production.
