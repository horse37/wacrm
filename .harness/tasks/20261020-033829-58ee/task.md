# Task — PostgreSQL template sync match lookup

- id: `20261020-033829-58ee`
- type: migration
- slug: `postgres-template-sync-match`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL lookup that finds the local template ID matched during template synchronization.

## Context

The template sync handler matches rows by exact verified account, template name, and language, then uses the matched ID for a later write. This slice covers only the read and does not call a provider or perform that write. The previous template lifecycle config repository received independent GPT-6 Luna `APPROVE` limited to its read-only scope. PostgreSQL in disposable Docker Desktop only; never Supabase.

## In scope

- Return only a validated template UUID or `null` for no matching visible row.
- Preserve exact account/name/language matching without status filters or language defaults.
- Require verified account membership, explicit account predicate, transaction-local RLS identity, bound SQL parameters, and creator profile/account consistency.
- Fail closed on duplicate matches, malformed IDs, and invalid inputs.
- Prove forced RLS, runtime `NOBYPASSRLS`, and exact minimum column grants in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, writes, Meta/provider calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all existing local work. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with failing focused Vitest. Run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration using forced RLS, `NOBYPASSRLS`, exact minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic records/generated credentials, and cleanup verification. Obtain a fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent; the focused test now passes 9/9.
- Added a read-only server repository that binds exact account/name/language values, joins the creator profile to the same account, returns only a validated UUID, returns null for no visible match, and rejects duplicate or malformed results.
- `npm run typecheck` passed. Targeted ESLint passed with `--max-warnings=0`. Prettier check passed for the changed code, test, integration script, and task/handoff records. PowerShell AST and fixture checks passed in the integration runner. `git diff --check` passed with existing line-ending warnings only.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with `NOBYPASSRLS`, minimum column SELECT grants, account/name/language and creator isolation, no-match/orphan/duplicate cases, `--network none`, tmpfs, read-only mounts, generated credentials, and cleanup. Evidence: `validation-postgres-template-sync-match-dcbdd8c769.log`.
- No route wiring, writes, provider calls, Supabase, real data/credentials, application traffic, production, commit, push, or deploy.

## Next action

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, zero caveats, and no additional validation needed, limited to this repository slice. Next task `20261020-034647-d1e1` isolates sync-result persistence in a separate PostgreSQL repository. Keep the sync route unwired, this task `in_progress`, and H-DATA-003/H-DB-003 unapproved overall.
