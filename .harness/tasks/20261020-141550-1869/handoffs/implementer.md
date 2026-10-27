# Implementer handoff — PostgreSQL invitation preview GET route

## Scope

Migrate only persistence in public `GET /api/invitations/[token]/peek` from Supabase RPC to `createPostgresInvitationPreviewRepository`. Preserve the public URL, rate limit, SHA-256 hash utility, response reasons, and safe server-error response.

## Changes

- Removed the Supabase client/RPC call from the GET handler.
- Preserved rate-limit-before-lookup order, `x-forwarded-for` key, token hash utility, public response bodies/statuses, and safe 500 mapping.
- Added focused route tests for hash-only repository input, public success/failure reasons, the empty-token guard, rate limiting, no Supabase call, and database failure sanitization.

## Validation

- TDD RED: 5 expected failures, 2 guard tests passed.
- Focused route + repository Vitest: 18/18; `npm run typecheck`: pass; targeted ESLint with `--max-warnings=0`: pass.
- Prettier check passed for new test/task/handoff files and the changed ranges in the existing route/current-task files; `git diff --check`: pass.
- Disposable PostgreSQL 16 repository proof passed in Docker Desktop with synthetic rows and no residual containers. Evidence: `.harness/tasks/20261019-225101-d76a/validation-postgres-invitation-preview-32cd338686.log`.

## Review, limits, and next action

Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings/caveats; see `../review-gpt6-luna-20261020.md`. No Supabase persistence/network, real credentials/data, app traffic, or production. Repository, RPC, schema, grants, Auth, and redemption are unchanged. Approval remains limited to this route slice; H-DB-003/H-DATA-003 stay unapproved. Continue with the next narrow repository-backed route task.
