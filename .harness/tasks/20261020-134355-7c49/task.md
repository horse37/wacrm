# Task — PostgreSQL flow run history route

- id: `20261020-134355-7c49`
- type: migration
- slug: `postgres-flow-run-history-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Serve `GET /api/flows/[id]/runs` entirely from existing account-scoped PostgreSQL flow-run and flow-run-event repositories.

## Scope

Only this GET route's flow, run, contact-summary, and event reads changed. Keep the verified server-session boundary, `{ flow, runs, events }`, 401 behavior, hidden not-found for inaccessible flows, 50-run limit, and non-fatal event loading failures. No Supabase database/service is started or contacted.

## Validation

TDD RED had 4 expected failures and 1 pass. Final focused route/repository Vitest passed 38/38; TSC, targeted zero-warning ESLint, targeted Prettier, and `git diff --check` passed. Both disposable PostgreSQL 16 forced-RLS validations passed; details and evidence paths are in `validation-final.log`.

Docker used synthetic data, `--network none`, tmpfs, read-only source mounts, and `--rm`; both runs confirmed no residual task resources. No Supabase service, real credentials/data, application traffic, production, commit, push, or deploy was used.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; see `review-gpt6-luna-20261020.md`. Scope was limited to this GET route, tests, and task evidence. It confirmed PostgreSQL reads, response/error compatibility, and non-fatal event failures.

Approval covers only this route slice. Auth replacement, writes, H-DB-003, H-DATA-003, and production readiness remain outside scope. HARNESS task remains `in_progress`.

## Next action

Continue with the next focused PostgreSQL read route. Keep H-DB-003/H-DATA-003 unapproved overall.