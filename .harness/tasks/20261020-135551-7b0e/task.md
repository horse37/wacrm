# Task — PostgreSQL WhatsApp config GET route

- id: `20261020-135551-7b0e`
- type: `migration`
- slug: `postgres-whatsapp-config-get-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Use the existing account-scoped PostgreSQL configuration repository for `GET /api/whatsapp/config` while preserving verified server-session authentication, Meta credential verification, and existing response behavior.

## Context

The route currently reads the account and WhatsApp config through Supabase before decrypting the token and asking Meta to verify it. A PostgreSQL repository and disposable PostgreSQL integration already exist. Auth/session is a compatibility boundary and remains unchanged.

## In scope

- Migrate only GET persistence reads to `createPostgresWhatsAppConfigRepository`.
- Preserve 401, `no_account`, `db_error`, `no_config`, token-decryption failure, Meta verification success/failure payloads and status codes.
- Add focused route tests proving PostgreSQL repository usage, no Supabase persistence calls, safe token handling, and compatibility branches.
- Re-run focused unit tests, typecheck, targeted zero-warning ESLint, Prettier, `git diff --check`, and the existing disposable Docker PostgreSQL 16 repository integration.

## Out of scope

POST/DELETE, Auth/session provider or policy, encryption changes, Meta API behavior, schema/RLS/grant/role changes, Supabase services or persistence, real credentials/data, app traffic, production, commit, push, deploy, reset, restore, clean, rebase, or branch changes. Keep H-DB-003/H-DATA-003 unapproved overall.

## Next action

Continue with the public invitation-preview GET route using its existing PostgreSQL repository. This task remains `in_progress`; approval is slice-limited.

## Implementation and validation

- TDD RED: route tests failed as expected before implementation (6 failed, 1 passed); evidence: `tdd-red-whatsapp-config-route.log`.
- GET now uses the existing account-scoped PostgreSQL repository, passes only the server-verified user ID as session context, maps missing membership to the existing `no_account` response, preserves safe `db_error` and `no_config` responses, and retains decryption plus Meta verification behavior. POST/DELETE remain unchanged.
- Focused route/repository Vitest passed 14/14; TypeScript, targeted ESLint with `--max-warnings=0`, Prettier checks for the new test/task files, and `git diff --check` passed. Final transcript: `validation-focused-final.log`. After clarifying the existing POST/DELETE helper comment, the focused checks were rerun and passed; see `validation-post-comment-final.log`.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed using synthetic data, `NOBYPASSRLS`, exact grants, `--network none`, tmpfs, read-only mounts, and cleanup verification. Evidence: `validation-postgres-whatsapp-config-8c73a7cbb4.log`.
- Route tests mock both encryption and Meta verification. No Supabase persistence, real Meta request, real credentials/data, application traffic, or production was used. Existing Supabase server-session verification remains the unchanged auth boundary. H-DB-003/H-DATA-003 remain unapproved overall.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats. The reviewer confirmed verified-session identity propagation, account-scoped PostgreSQL reads, preserved response branches, no decrypted token in the response, and unchanged POST/DELETE behavior. Record: `review-gpt6-luna-20261020.md`. Approval covers this GET route slice only; H-DB-003, H-DATA-003, Auth replacement, and production remain unapproved/out of scope.
