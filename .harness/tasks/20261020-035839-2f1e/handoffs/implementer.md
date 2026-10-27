# Implementer handoff — PostgreSQL template submission persistence

## Start state

- Task `20261020-035839-2f1e`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve dirty/untracked work. Use task-owned synthetic PostgreSQL in Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only repository for the result of one template submission. Match the legacy key `(user_id, name, language)` within the verified account; do not change it to account-wide name/language deduplication. Require verified admin membership, explicit account/user predicates, creator profile/account consistency, transaction-local identity, parameterized values, fail-closed duplicate and row checks, and same-key transaction serialization. Persist both DRAFT/provider-error and normalized-status/provider-success results. Clear rejection reason on each submit and update `header_media_url` from the new submission payload. Return only template UUID plus inserted/updated action.

No route/UI wiring, provider calls, network traffic, Auth/session replacement, schema/grant/RLS changes, Supabase, real credentials/data, app traffic, or production. Writes only to synthetic disposable Docker PostgreSQL.

## Validation and review

- TDD RED confirmed the module was missing; focused Vitest passed 31/31. TypeScript, targeted zero-warning ESLint, Prettier check, and `git diff --check` passed.
- The first independent review required matching the existing template business validators. The repository reuses `validateTemplatePayload`, and negative tests cover invalid names, body text, media URLs, and URL-button limits.
- The second independent review required cross-field result validation. Provider failure requires DRAFT/no Meta ID/nonempty error; provider success requires Meta ID/no error, while a success response with DRAFT status remains valid. Negative cases reject before opening a transaction.
- The third independent review required preserving the current route's rejection of Authentication-category submissions. The repository now rejects that category before opening a transaction.
- The fourth independent review required the advisory lock to use the exact legacy unique key. It now hashes only `(user_id,name,language)`; a unit test compares lock inputs under different account contexts.
- Docker Desktop PostgreSQL 16 integration passed with `NOBYPASSRLS`, forced RLS, exact minimum column grants, `--network none`, tmpfs, read-only mounts, generated credentials, synthetic data, per-user uniqueness, same-key concurrency, and cleanup. Final evidence: `../validation-postgres-template-submit-persistence-8580d82154.log`. Earlier failed attempts remain in the task directory.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this unwired repository slice only. The final validation log records the result. It does not approve route wiring or H-DATA-003/H-DB-003 overall.
- Task `20261020-042158-7c91` continues with lifecycle edit persistence. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Continue task `20261020-042158-7c91` with lifecycle edit persistence. Keep the submit route unwired; do not contact Meta.
