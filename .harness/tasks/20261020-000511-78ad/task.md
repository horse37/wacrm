# Task — PostgreSQL contact custom-value read repository

- id: `20261020-000511-78ad`
- type: `migration`
- slug: `postgres-contact-custom-values-read`

## Goal

Add a server-only repository to list custom-field values for one contact in the verified account.

## Context

H-DATA-003 phase 03. Contact, tag, contact-tag, and custom-field-definition read slices have limited independent Luna approvals. Use PostgreSQL in task-owned disposable Docker Desktop only; do not use Supabase. Keep consumers unwired pending H-SELF-002 and H-DB-003.

`contact_custom_values` has no account column. Derive tenancy through its contact and custom-field parents; both parents must belong to the verified account.

## In scope

- Require verified account membership, validate contact UUID, and set transaction-local RLS identity.
- Read values for the requested contact with explicit guard-derived contact account scope and same-account custom-field join.
- Map existing `ContactCustomValue` projection in stable custom-field ID and value-row ID order.
- Add focused tests and synthetic forced-RLS PostgreSQL Docker integration for projection, isolation, cross-account-link exclusion, empty results, invalid IDs, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, contact/custom-field writes, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this contact custom-value read slice only. Keep this task `in_progress` and consumers unwired; next is a separate contact-note read.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/contact-custom-values.ts` with verified-account guard, transaction-local RLS identity, validated contact UUID, explicit contact account scope, same-account custom-field join, `ContactCustomValue` projection, null handling, and stable order.
- Focused repository and account-guard Vitest passed 14/14; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier passed. PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual resources. Projection/null handling, stable order, account/contact isolation, cross-account field-link exclusion, viewer access, empty result, invalid/no-session rejection, fail-closed RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261020-000511-78ad/validation-postgres-contact-custom-values-0d5476cdc0.log`.
- No Supabase, consumer wiring, Auth/session changes, writes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.

## Independent read-only review

- Fresh same-model GPT-6 Luna review returned exactly `APPROVE`, with zero findings and zero caveats. Approval is limited to this contact custom-value read; H-DATA-003 overall and consumers remain unapproved.
