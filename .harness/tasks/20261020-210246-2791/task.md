# Task — PostgreSQL WhatsApp config delete route

- id: `20261020-210246-2791`
- type: `migration`
- slug: `postgres-whatsapp-config-delete-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Move `DELETE /api/whatsapp/config` persistence from Supabase admin writes to the account-scoped PostgreSQL repository, preserving verified-session authentication and `{ success: true }` response.

## Context

`GET /api/whatsapp/config` uses `createPostgresWhatsAppConfigRepository` and was independently approved in `.harness/tasks/20261020-135551-7b0e/`. The DELETE route still reads the caller's account through Supabase and deletes via Supabase admin. Existing migration policy `whatsapp_config_delete` requires account role `admin`; owner also satisfies this through the existing role hierarchy. Keep Auth/session verification unchanged.

## In scope

- Add an account-scoped repository delete method that requires admin membership from the verified session, sets transaction-local `auth.uid()` context, and deletes only the current account's config.
- Wire only the DELETE handler to PostgreSQL; map unauthenticated, unauthorized, and database failures to safe HTTP responses. Missing config remains idempotent success.
- Add repository, route, and forced-RLS Docker integration tests for allowed admin deletion, denial of non-admin, cross-account isolation, and no Supabase persistence/admin calls.

## Out of scope

GET/POST config behavior, Supabase Auth/session replacement, UI, Meta API, encryption, schema/RLS/permanent grant changes, real data/credentials, Supabase services, VPS, production, application traffic, commit, push, deploy, reset, restore, clean, rebase, or branch changes. Preserve all existing local work. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- TDD RED for route/repository tests before implementation.
- Focused Vitest, TypeScript, targeted ESLint `--max-warnings=0`, Prettier, and `git diff --check`.
- Disposable Docker Desktop PostgreSQL 16 with synthetic data, forced RLS, `NOBYPASSRLS`, exact task-local grants, `--network none`, tmpfs, read-only source mount, and cleanup proof; no Supabase.
- Independent GPT-6 Luna read-only review; remediate and rerun affected checks until `APPROVE`, zero findings, and zero caveats.

## Next action

Independent read-only GPT-6 Luna review returned `APPROVE`, 0 findings, 0 caveats for this DELETE slice. Await the owner's independent Opus 5.5 review using `opus55-review-prompt.md`; decide the next narrow H-DATA-003 slice afterward. Do not infer global approval.

## Implementation status

- TDD RED was recorded before production changes: 6 expected failures and 8 existing passes in `red-tests-delete-20261020.log`.
- Added `deleteConnectionConfig()` to the existing PostgreSQL config repository. It requires admin membership, sets the verified user as transaction-local RLS identity, and deletes only by the verified account ID; absent rows are successful no-ops.
- `DELETE /api/whatsapp/config` now delegates to PostgreSQL after unchanged server-session verification. It maps unauthorized/forbidden/database errors safely and preserves `{ success: true }`. GET and POST are untouched.
- Focused route/repository tests passed 21/21. `npm run typecheck`, targeted ESLint `--max-warnings=0`, both scoped Prettier checks, PowerShell validator parsing, and `git diff --check` passed; logs are in this task directory. A malformed first Prettier range invocation is archived as `prettier-invocation-error.log`; final checks used separate verified arguments.
- Disposable Docker Desktop PostgreSQL 16 integration passed with `NOBYPASSRLS`, synthetic users/accounts, admin-only task-local DELETE grant and forced-RLS policy, account scoping, cross-account denial, non-admin denial, idempotent repeat deletion, transaction identity cleanup, `--network none`, tmpfs, read-only source mount, and no residual resources. Evidence: `validation-postgres-whatsapp-config-delete-b9ce3c1ef2.log`.
- No Supabase service/persistence, real data/credentials, application traffic, VPS, or production was used. H-DATA-003/H-DB-003 remain unapproved overall.
