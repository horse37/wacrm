# Task — PostgreSQL flow delete route
- id: `20261020-202740-c318`
- type: `migration`
- slug: `postgres-flow-delete-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `DELETE /api/flows/[id]` to the approved PostgreSQL flow-delete repository.

## Context

The route previously queried ownership through Supabase and deleted through its admin client. `flow-delete-persistence` already has disposable PostgreSQL 16 forced-RLS evidence. Keep the existing verified-session Auth call; do not use Supabase for flow data.

## In scope

- Preserve verified-user authentication and `{ ok: true }` success response.
- Delegate deletion plus ownership/account/role checks to `createPostgresFlowDeletePersistenceRepository`.
- Map repository errors to safe HTTP status/messages.
- Add mocked-auth route tests for delegation, authentication, errors, response, and no Supabase data/admin calls.
- Update task evidence and handoff.

## Out of scope

GET/PUT handlers; UI; Auth/session replacement; repository, schema, RLS, grant, or role changes; Supabase database/service access; real credentials/data; provider calls; app traffic; production; commit, push, deploy, reset, clean, or branch change. H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation

`DELETE` keeps `requireVerifiedUser()`, delegates `deleteOwnedFlow(id)` to PostgreSQL, preserves `{ ok: true }`, and maps `toAppError` to safe 401/403/400/404/409/500 responses. Removed unused Supabase ownership helper/admin import from this route module. GET and PUT behavior were not changed in this slice.

## Validation

See [`validation-focused-20261020.log`](validation-focused-20261020.log). TDD RED: five expected failures before route wiring. Focused route/repository tests passed 24/24 across two files; TypeScript, targeted zero-warning ESLint, Prettier check, and `git diff --check` passed. Reused existing disposable PostgreSQL 16 forced-RLS proof because repository/SQL/RLS/grants were unchanged.

## Independent review

GPT-6 Luna read-only review returned exact `APPROVE`, 0 findings, and 0 caveats for this DELETE route slice. Record: `review-gpt6-luna-final-20261020.md`.

## Next action

Continue with the next narrow PostgreSQL route. H-DATA-003/H-DB-003 remain unapproved overall.