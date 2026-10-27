# Implementer handoff — PostgreSQL template lifecycle context read

## Start state

- Task 20261020-032314-a83c, status in_progress, H-DATA-003 phase 03.
- Repository C:\Sistemas\wacrm; branch main; expected HEAD 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c.
- Preserve all existing dirty/untracked files. Use disposable PostgreSQL in Docker Desktop only; never Supabase.
- No route wiring, Meta calls, writes, commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only PostgreSQL repository for two minimal template lifecycle reads:

- Edit context: status and nullable meta_template_id.
- Delete context: name and nullable meta_template_id.

Both reads use a validated template UUID, verified account membership, explicit account predicate, creator profile/account join, transaction-local RLS identity, bound SQL parameters, and null for missing/out-of-account rows. Keep existing consumers unwired.

## Validation and review

Start with a failing focused Vitest. Then run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, git diff --check, and disposable Docker Desktop PostgreSQL 16 forced-RLS integration with NOBYPASSRLS, exact minimum SELECT grants, --network none, tmpfs, read-only mounts, synthetic records/generated credentials, and cleanup verification. Obtain a fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact APPROVE, zero findings, and zero caveats. Keep task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Implemented slice and validation

- Added template-lifecycle-context.ts and its Vitest coverage. Edit reads project only status/meta_template_id; delete reads only name/meta_template_id. Both are account-scoped, creator-consistent, parameterized, transaction-local-RLS reads that return null for rows outside scope.
- TDD RED confirmed the repository module was absent. Focused Vitest passed 7/7; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and git diff --check passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with NOBYPASSRLS, exact minimum column grants, synthetic two-account/template data, --network none, tmpfs, read-only mounts, generated credentials, and no residual resources. Evidence: validation-postgres-template-lifecycle-69d6dc66c9.log.
- No route wiring, writes, Meta calls, Supabase, real data/credentials, app traffic, production, commit, push, or deploy.

## Next action

Fresh independent GPT-6 Luna read-only review returned exact APPROVE, zero findings, and zero caveats, limited to this repository slice. Next: inspect and isolate the minimal account-scoped WhatsApp configuration read used by template lifecycle handlers. Keep task in_progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly APPROVE, zero findings, and zero caveats, for this slice only. No route wiring, Meta calls, or writes were reviewed or approved.
