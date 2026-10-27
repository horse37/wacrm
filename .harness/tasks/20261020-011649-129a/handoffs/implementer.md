# Implementer handoff — PostgreSQL pipeline deal delete

## Start state

- Task `20261020-011649-129a`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty/untracked work. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only repository delete for one deal. Require the default verified-account guard with minimum `agent`; validate UUID; set `request.jwt.claim.sub` transaction-locally; issue parameterized `DELETE ... WHERE account_id = verifiedAccount AND id = requestedDeal`; require same-account deal/pipeline creator rows; return safe `not_found` for inaccessible/inconsistent records. The existing product prohibition applies to message records, not deal records; migration 017 and the existing editor authorize deal deletion for `agent` or higher.

Do not wire UI/routes or modify message handling, Auth/session, schema/grants/RLS, or other repositories. Check the schema to confirm delete side effects, then test that only the target deal disappears.

## Review remediation — 2026-10-20

Initial validation passed, but independent same-model GPT-6 Luna read-only review found one P2: runtime fixture grants SELECT on `pipeline_stages` and `contacts`, which the repository does not need. Both grants are removed; integration asserts those privileges are false and uses a separate disposable bootstrap audit connection for parent preservation counts. Post-fix Vitest 15/15, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/exact-grant checks, `git diff --check`, and Docker PostgreSQL 16 integration all passed. Initial evidence is `../validation-postgres-pipeline-deal-delete-99b5c658fa.log`; final post-fix evidence is `../validation-postgres-pipeline-deal-delete-e17e865366.log`. Fresh independent GPT-6 Luna re-review returned `APPROVE`, zero findings/caveats, limited to this deal-delete slice.

Keep task `in_progress` and consumers unwired. H-DATA-003/H-DB-003 overall remain unapproved.
