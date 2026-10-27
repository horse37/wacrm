# Task — PostgreSQL contact-note read repository

- id: `20261020-000914-5cc2`
- type: `migration`
- slug: `postgres-contact-note-list-read`

## Goal

Add a server-only repository to list notes for one contact in the verified account.

## Context

H-DATA-003 phase 03. Contact, tag, custom-field-definition, and contact-custom-value read slices have limited independent Luna approvals. Use PostgreSQL in task-owned disposable Docker Desktop only; do not use Supabase. Keep consumers unwired pending H-SELF-002 and H-DB-003.

`contact_notes` has `account_id`; also verify that each note's contact parent belongs to that same verified account.

## In scope

- Require verified account membership, validate contact UUID, and set transaction-local RLS identity.
- Read notes for the requested contact with explicit guard-derived account scope and same-account contact join.
- Map existing `ContactNote` projection in newest-first order with stable ID tie-break.
- Add focused tests and synthetic forced-RLS PostgreSQL Docker integration for mapping, isolation, mismatched-parent exclusion, empty results, invalid IDs, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, note writes/deletes, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this contact-note read slice only. Keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/contact-note-list.ts` with verified-account guard, transaction-local RLS identity, validated contact UUID, explicit note account scope, same-account contact join, `ContactNote` projection, and newest-first stable order.
- Focused repository and account-guard Vitest passed 13/13; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier passed. PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual resources. Projection/order, account/contact isolation, mismatched-parent exclusion, viewer access, empty result, invalid/no-session rejection, fail-closed RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261020-000914-5cc2/validation-postgres-contact-note-list-aa18e3cd0a.log`.
- No Supabase, consumer wiring, Auth/session changes, writes/deletes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.

## Independent read-only review

- Fresh same-model GPT-6 Luna review returned exactly `APPROVE`, with zero findings and zero caveats. Approval is limited to this note-list repository; H-DATA-003 overall and consumers remain unapproved.
