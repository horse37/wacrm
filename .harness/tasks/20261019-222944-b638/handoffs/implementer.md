# Implementer handoff — PostgreSQL account member role repository

## Start state

- Task: `20261019-222944-b638`, `postgres-account-member-role-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty work and prior task evidence.
- PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## Scope boundary

Implement only a repository wrapper for the existing `public.set_member_role` function. Require admin+, bind the target ID and non-owner target role, set verified identity transaction-locally, reject self-change and invalid/missing/owner targets without revealing cross-account existence, and retain the RPC as final authorization. The route and existing migration 018 function remain unchanged. Do not alter permanent grants/RLS.

## Progress

- Opened after independent Luna `APPROVE` for the account invitation revoke repository slice.
- Existing PATCH route calls `set_member_role(p_user_id, p_new_role)`. The migration function enforces admin+, same-account membership, no self-change, and no owner promotion/demotion. The app repository remains unwired pending verified-session and grant decisions.
- Added server-only `setRole`. It requires admin+, rejects self/owner/invalid role/malformed target IDs, scopes preflight to the guarded account, returns not-found for missing/cross-account targets, sets identity transaction-locally, then calls the existing RPC with bound parameters. Migration 018 and route are unchanged.
- TDD RED failed because the module was absent. After remediation, focused Vitest passed 46/46 across seven account repository/guard files; TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier passed.
- Disposable PostgreSQL 16 Docker proof passed after remediation using synthetic accounts, `NOBYPASSRLS`, network isolation, tmpfs, read-only mounts, and a temporary fixture copy of the migration RPC contract. Final evidence: `../validation-postgres-account-member-role-28353dc437.log`; no resources remain.
- One earlier integration attempt returned generic `db_error`; the final rerun passed after removing read-preflight row locks. The RPC remains the final authorization boundary.
- First independent Luna review found one P2: uppercase hexadecimal in the caller's UUID bypassed the case-sensitive self-target precheck and reached the RPC. Added lowercase normalization and an uppercase-self regression test; the regression failed before the code fix. All focused, static, formatting, and PostgreSQL validations passed after the fix; independent read-only re-review is pending.

## Next action

Final `git diff --check` and untracked fixture whitespace checks passed. Independent same-model Luna read-only re-review returned `APPROVE`, zero findings/caveats, limited to this slice. Keep task `in_progress` and route unwired; next narrow repository slice is member removal through the existing RPC, without route wiring.
