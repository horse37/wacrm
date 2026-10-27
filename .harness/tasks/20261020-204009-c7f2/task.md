# Task — PostgreSQL flow create route

- id: `20261020-204009-c7f2`
- type: `migration`
- slug: `postgres-flow-create-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire `POST /api/flows` to the independently approved PostgreSQL flow-create persistence repository.

## Context

The persistence repository and forced-RLS Docker PostgreSQL proof are recorded in `.harness/tasks/20261020-052532-c1b8/`. This route still uses Supabase to read profile/account data and insert flows/nodes. Preserve the existing verified-server-session Auth call; repository derives account and role from PostgreSQL membership.

## In scope

- Plain draft creation and template cloning through `createPostgresFlowCreatePersistenceRepository`.
- Preserve HTTP 201 and the `flow.id` field used by the existing UI.
- Map repository errors to safe HTTP status/messages; unknown templates and invalid JSON remain 400.
- Add focused route tests for authentication, delegation, template payload, error mapping, and absence of Supabase data/admin calls.

## Out of scope

GET/other flow routes, UI, Supabase Auth/session replacement, repository/schema/RLS/grant changes, Storage, Realtime, real data/credentials, application traffic, production, commits, push, deploy, reset, clean, rebase, or branch changes. Do not claim H-DATA-003/H-DB-003 completion.

## Validation

- TDD RED for the new route tests before route wiring.
- Focused route and repository tests, TypeScript, targeted zero-warning ESLint, Prettier check, and `git diff --check`.
- Reuse existing disposable forced-RLS PostgreSQL evidence because this slice changes only route wiring and tests.
- Independent read-only GPT-6 Luna review; fix findings and repeat affected checks until `APPROVE`, zero findings, zero caveats.

## Next action

This route slice received independent read-only GPT-6 Luna `APPROVE`, zero findings/caveats. Prompt Opus 5.5 is saved at `.harness/tasks/20261020-204009-c7f2/opus55-review-prompt.md`. Current continuation may proceed to the next narrow slice; external Opus review can be recorded separately.

## Implementation and validation

- Preserved the existing verified-server-session Auth call. Plain drafts and template metadata/nodes now go through the approved PostgreSQL repository; template graph creation stays atomic in its existing repository transaction.
- Removed route-level Supabase profile reads and admin inserts. Unknown templates and invalid bodies return 400; repository errors map to safe 401/403/400/404/409/500 responses. Success returns HTTP 201 with `{ flow: { id } }`, the field consumed by the existing UI.
- TDD RED recorded 12 expected failing assertions before route wiring (`tdd-red-route-20261020.log`). Focused route/repository tests passed 29/29 (`validation-focused-tests.log`).
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier check, and `git diff --check` passed; evidence logs are in this task directory.
- Reused disposable PostgreSQL 16 forced-RLS repository proof from `.harness/tasks/20261020-052532-c1b8/validation-postgres-flow-create-bbdff29cdb.log`; repository, SQL, RLS, and grants were unchanged.
- No Supabase flow-data calls, real data/credentials, application traffic, production, commit, push, or deploy. Task and H-DATA-003/H-DB-003 remain `in_progress`/unapproved overall pending review.
- Independent GPT-6 Luna read-only review approved this route slice with zero findings/caveats; report: `review-gpt6-luna-final-20261020.md`. HARNESS task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
