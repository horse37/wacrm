# Implementer handoff — PostgreSQL WhatsApp config GET route

## Scope

Task `20261020-135551-7b0e` migrates only persistence reads in `GET /api/whatsapp/config` to `createPostgresWhatsAppConfigRepository`. The route still uses the existing server-side session verifier, decrypts the encrypted token server-side, and calls the existing Meta verification helper. POST and DELETE behavior is outside this slice.

## Changes

- The GET handler no longer reads `profiles` or `whatsapp_config` through Supabase.
- Missing PostgreSQL membership maps to the existing `no_account` response. Database/config absence and token/Meta failures preserve the existing response contract.
- Focused route tests assert verified identity propagation, no Supabase persistence reads, response compatibility, and no access-token disclosure.
- Added task-owned copy of the disposable PostgreSQL config fixture and validator.

## Validation

- TDD RED: 6 expected failures and 1 pass before route wiring.
- Focused route/repository Vitest: 14/14.
- `npm run typecheck`: passed.
- Targeted ESLint with `--max-warnings=0`: passed.
- Prettier checks for the new route test and task record: passed; GET handler formatted with the Prettier range option.
- `git diff --check`: passed.
- Docker Desktop PostgreSQL 16 forced-RLS integration: passed; synthetic fixture, no bypass RLS, exact grants, `--network none`, tmpfs, read-only mounts, no residual task resources. Log: `../validation-postgres-whatsapp-config-8c73a7cbb4.log`.
- After clarifying the helper comment for the unchanged POST/DELETE paths, focused Vitest, TypeScript, targeted ESLint, Prettier, and `git diff --check` were rerun successfully. Log: `../validation-post-comment-final.log`.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; approval is limited to this GET route slice. Continue with the public invitation-preview GET route using its existing PostgreSQL repository. Keep `H-DB-003`, `H-DATA-003`, Auth replacement, Storage, Realtime, and production unapproved/out of scope.
