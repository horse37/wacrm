# Implementer handoff — PostgreSQL ownership-transfer POST route

## Scope

Replace only `POST /api/account/transfer-ownership` direct Supabase RPC usage with the existing PostgreSQL repository. Keep current Auth verification and owner guard, rate limiting, request/response contract, and migration 018 RPC/schema/grants unchanged. Map SQLSTATE `42501` to 403 and `22023` to 400 without returning raw database messages.

## Start state

- Task: `20261020-145507-8c48`, `postgres-account-ownership-transfer-post-route`, `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work and prior task evidence.

## Next action

TDD RED had 9 failures and 2 passes. Final focused route tests passed 12/12; TypeScript, targeted zero-warning ESLint, Prettier, and `git diff --check` passed. Existing disposable Docker PostgreSQL 16 proof was reused because repository/RPC/schema stayed unchanged. Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats; evidence: `../review-gpt6-luna-final-20261020.md`. Approval is limited to this task and route. No Supabase persistence/network, real credentials/data, application traffic, production, commit, push, or deploy.
