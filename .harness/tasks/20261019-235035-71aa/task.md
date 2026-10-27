# Task — PostgreSQL contact-tag assignment read repository

- id: `20261019-235035-71aa`
- type: `migration`
- slug: `postgres-contact-tag-assignment-read`

## Goal

Add a server-only repository to list tag assignments for one verified-account contact.

## Context

H-DATA-003 phase 03. The PostgreSQL tag-catalog read received independent Luna APPROVE, limited to that slice. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase. Keep consumers unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership for any account role and set transaction-local RLS identity.
- Validate the contact UUID and query `public.contact_tags` through its contact and tag parents.
- Explicitly scope the contact to the guard-derived account and exclude links whose tag belongs to another account.
- Return the existing `ContactTag` projection in stable creation order.
- Add focused tests and synthetic forced-RLS PostgreSQL Docker integration for assignment mapping, isolation, cross-account link exclusion, empty results, invalid IDs, and pooled identity cleanup.

## Out of scope

- UI/route wiring, Supabase/Auth replacement, tag or assignment writes, tag-detail projection, schema/grant/RLS changes, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

The fresh authorized independent same-model Luna re-review returned APPROVE with zero findings and caveats for this contact-tag repository slice only. Keep task `in_progress` and consumers unwired; continue with the next separate account-scoped domain read.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/contact-tags.ts` with verified-account guard, transaction-local identity, validated UUID, explicit contact/account predicates, same-account tag-parent join, `ContactTag` projection, and stable order.
- Focused Vitest passed 14/14; TypeScript and targeted ESLint (`--max-warnings=0`) passed; Prettier check passed after formatting; PowerShell AST/fixture whitespace and `git diff --check` passed.
- First disposable PostgreSQL 16 Docker integration passed with synthetic forced-RLS data, `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual resources. After cleanup remediation, the same integration passed again: `.harness/tasks/20261019-235035-71aa/validation-postgres-contact-tags-21c30c6ecc.log`.
- Cleanup failure-path injection made the wrapper return exit 37 after performing the real `docker rm -f`; the validator returned exit 1 and logged the cleanup failure. The final residual check found no task containers. Evidence: `.harness/tasks/20261019-235035-71aa/validation-postgres-contact-tags-d9bb796571.log`.
- H-DATA-003 overall remains unapproved. No Supabase, consumers, Auth/session changes, writes, schema/grants/RLS changes, Storage, Realtime, real data, traffic, or production were touched.

## Independent read-only review

- First fresh same-model Luna review found one P2: cleanup results were only logged, not enforced; a failed residual check could also appear empty. Corrected `scripts/testing/validate-postgres-contact-tags.ps1` to fail when container inspection/removal fails, the residual check fails, or any task container remains. A fresh re-review approved this slice with zero findings/caveats. No H-DATA-003-wide approval is claimed.
- Fresh independent same-model Luna re-review returned `APPROVE`, zero findings, and zero caveats after the cleanup correction. Approval remains limited to this contact-tag read slice; H-DATA-003 overall and consumers remain unapproved.
