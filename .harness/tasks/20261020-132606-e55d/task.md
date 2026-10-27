# Task — PostgreSQL flow-list route

- id: `20261020-132606-e55d`
- type: migration
- slug: postgres-flow-list-route
- roadmap: H-DATA-003, phase 03
- status: in_progress

## Goal

Serve `GET /api/flows` from the account-scoped PostgreSQL flow-list repository.

## Context

`src/lib/repositories/flow-list.ts` has focused unit and disposable PostgreSQL 16 coverage. The route still reads flows directly through Supabase. Preserve the current verified server-session check; Supabase Auth replacement is H-SELF-002 and remains separate. No Supabase database/service is started or contacted in this task; tests mock the existing session verifier and PostgreSQL integration uses disposable Docker resources only.

## In scope

- Change only the `GET /api/flows` data read to `createPostgresFlowListRepository` using the verified session user ID.
- Preserve the `{ flows }` response shape and 401 behavior; map repository errors to safe HTTP responses.
- Add route tests for unauthorized access, successful PostgreSQL delegation/DTO response, safe errors, and absence of Supabase data/admin queries on GET.
- Update this task's evidence and handoff.

## Out of scope

- `POST /api/flows`, flow detail/node/run/template writes, UI, other routes, Auth/session replacement, permanent SQL/RLS/grants/roles, Supabase service use, real credentials/data, application traffic, production, commit, push, or deploy.
- Do not change the existing Supabase Auth call in this slice; it remains an existing verified-session boundary pending H-SELF-002.

## Validation

- TDD RED and focused route/repository Vitest.
- Re-run `scripts/testing/validate-postgres-flow-list.ps1`; it uses disposable PostgreSQL and Node containers only, `--network none`, tmpfs database storage, and read-only source mounts.
- `npx tsc --noEmit`; targeted ESLint with `--max-warnings=0`; targeted Prettier; `git diff --check` and task-record whitespace check.
- Independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, zero caveats.

## Next action

Implementation and focused validation are complete. Independent read-only GPT-6 Luna review returned exact `APPROVE`, zero findings, zero caveats; see `review-gpt6-luna-20261020.md`. This approval is limited to this route slice. Keep this task `in_progress` and H-DB-003/H-DATA-003 unapproved overall. Next narrow candidate: wire `GET /api/flows/[id]` to the existing PostgreSQL flow-editor-load repository; preserve writes and verified-session boundary.

## Validation results

See `tdd-red.log` and `validation-final.log`. Route/repository Vitest passed 20/20; TypeScript, targeted zero-warning ESLint, targeted Prettier, and `git diff --check` passed. Disposable PostgreSQL 16 flow-list integration passed; evidence is in `../20261020-015908-49b2/validation-postgres-flow-list-386d9c47eb.log`.

The route test mocks the existing server-session verifier and never calls Supabase. Docker validation used synthetic accounts/flows, `--network none`, tmpfs, read-only source mounts, and `--rm`; cleanup found no residual resources. No Supabase service, production, credentials, or real data were used.

## Independent review

GPT-6 Luna read-only review returned exact `APPROVE`, with zero findings and zero caveats. Scope was limited to GET route wiring and this task's records. The route file was Prettier-normalized; POST's behavior was not changed. Supabase Auth remains the existing server-session source; Auth replacement and all writes remain out of scope. H-DB-003/H-DATA-003 are not approved overall.
