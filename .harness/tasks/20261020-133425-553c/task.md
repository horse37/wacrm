# Task — PostgreSQL flow editor detail route

- id: `20261020-133425-553c`
- type: migration
- slug: `postgres-flow-editor-load-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Serve `GET /api/flows/[id]` from the existing account-scoped PostgreSQL flow-editor-load repository.

## Scope

Only GET data loading changed. The verified server-session boundary remains; `PUT` and `DELETE` are out of scope. GET keeps `{ flow, nodes }`, 401 behavior, not-found privacy, and safe repository error mapping. Tests verify PostgreSQL delegation and absence of Supabase data/admin reads.

## Validation

TDD RED had 4 expected failures and 1 pass. Final route/repository Vitest passed 17/17; TSC, targeted zero-warning ESLint, targeted Prettier, and `git diff --check` passed. Disposable PostgreSQL 16 forced-RLS integration passed; see `validation-final.log` and `../20261020-020502-d4a8/validation-postgres-flow-editor-load-b1c6c0d25b.log`.

Tests mock the existing verified server-session call. Docker used synthetic data, `--network none`, tmpfs and read-only source mounts; cleanup found no residual resources. No Supabase service, real data/credentials, application traffic, production, commit, push, or deploy was used.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; see `review-gpt6-luna-20261020.md`. Review covered GET wiring, task evidence, and semantic equivalence of `PUT`/`DELETE`; whole-file Prettier normalization changed their formatting only.

Approval covers only this GET route slice. Auth replacement, writes, H-DB-003, H-DATA-003, and production readiness remain outside scope. HARNESS task remains `in_progress`.

## Next action

Proceed with `GET /api/flows/[id]/runs`, using existing flow-run-list and flow-run-event-list repositories. This remains a separate route slice; keep H-DB-003/H-DATA-003 unapproved overall.