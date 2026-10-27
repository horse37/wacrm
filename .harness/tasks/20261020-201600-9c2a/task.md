# Task — PostgreSQL flow update route
- id: `20261020-201600-9c2a`
- type: `migration`
- slug: `postgres-flow-update-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `PUT /api/flows/[id]` to the approved PostgreSQL flow-header, graph-replacement, and editor-load repositories.

## Context

The route previously updated headers, optionally replaced nodes, and loaded the editor response through Supabase. The three PostgreSQL repositories already have separate forced-RLS PostgreSQL 16 evidence. Keep the existing verified-session Auth call; do not use Supabase for flow data.

## In scope

- Preserve request validation, verified-user Auth, allowlisted flow fields, optional graph replacement, editor DTO response, and safe HTTP status mapping.
- Delegate header update, optional graph replacement, and final editor load to the existing PostgreSQL repositories.
- Add mocked-auth route tests for delegation, validation, response, safe errors, and no Supabase data/admin calls.
- Record focused evidence and handoff.

## Out of scope

GET/DELETE handlers; UI; Auth/session replacement; repository, schema, RLS, grant, or role changes; Supabase database/service access; real credentials/data; provider calls; app traffic; production; commit, push, deploy, reset, clean, or branch change. H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation

`PUT` keeps `requireVerifiedUser()` and body/name checks. It delegates header changes to `flow-header-update`, replaces nodes only when the request contains `nodes` using `flow-node-graph-replace`, and loads the response using `flow-editor-load`. Repository failures map through `toAppError` to safe 401/403/400/404/409/500 responses. GET and DELETE handlers remain outside this slice.

## Validation

See [`validation-focused-20261020.log`](validation-focused-20261020.log). TDD RED: three expected failures before implementation. Focused route/repository/auth tests passed 52/52 across five files; TypeScript, targeted zero-warning ESLint, Prettier check, and `git diff --check` passed. Reused existing disposable PostgreSQL 16 forced-RLS proofs because repository/SQL/RLS/grants were unchanged.

## Independent review

GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for the PUT route slice. Record: `review-gpt6-luna-final-20261020.md`.

## Next action

Continue with the next narrow PostgreSQL flow route. H-DATA-003/H-DB-003 remain unapproved overall.