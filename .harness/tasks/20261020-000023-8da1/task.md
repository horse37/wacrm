# Task — PostgreSQL custom-field-definition read repository

- id: `20261020-000023-8da1`
- type: `migration`
- slug: `postgres-custom-field-list-read`

## Goal

Add a server-only repository to list custom-field definitions for the verified account.

## Context

H-DATA-003 phase 03. Contact, tag-catalog, and contact-tag read slices have limited independent Luna approvals. Use PostgreSQL in task-owned disposable Docker Desktop only; do not use Supabase. Keep existing consumers unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership for any account role and set transaction-local identity for RLS.
- Query `public.custom_fields` with an explicit guard-derived `account_id` predicate.
- Map the existing `CustomField` projection, including JSON options, and preserve `field_name` ascending order with stable ID tie-break.
- Add focused unit tests and synthetic forced-RLS PostgreSQL Docker integration for mapping, account isolation, ordering, empty results, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, custom-field writes, contact values, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Fresh independent same-model Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this custom-field-definition read slice only. Keep this task `in_progress` and consumers unwired; next is a separate contact custom-value read.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/custom-field-list.ts` with verified-account guard, transaction-local RLS identity, explicit account predicate, `CustomField` mapping, optional object-valued JSON options, and stable alphabetical order.
- Focused repository and account-guard Vitest passed 14/14; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier passed. PowerShell AST and new-file whitespace checks passed; `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic accounts/profiles/fields, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and cleanup. Projection/options, alphabetical and ID ordering, account isolation, viewer access, empty result, no-session rejection, pooled identity cleanup, and fail-closed RLS passed. Evidence: `.harness/tasks/20261020-000023-8da1/validation-postgres-custom-field-list-89b5389e4a.log`.
- No Supabase, consumer wiring, Auth/session changes, writes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.

## Independent read-only review

- Fresh same-model GPT-6 Luna review returned exactly `APPROVE`, with zero findings and zero caveats. Approval is limited to the custom-field-definition repository slice; H-DATA-003 overall and consumers remain unapproved.
