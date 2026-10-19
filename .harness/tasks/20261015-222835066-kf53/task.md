# Task — HARNESS adoption: WACRM

- id: `20261015-222835066-kf53`
- type: adoption
- slug: `adopt-existing-repo`

## Goal
Record WACRM's actual stack and validation workflow in HARNESS before the planned Evolution GO/PostgreSQL migration.

## Context
The repository plan targets Evolution GO plus self-hosted PostgreSQL. Current code still depends on Supabase for database access, Auth, RLS, Storage, and Realtime. PostgreSQL self-host replaces the database only; each other service needs an explicit replacement.

## In scope
- Document the current architecture and migration entry points in `docs/project-map.md`.
- Document available checks and database-testing limitations in `docs/testing.md`.
- Preserve adoption state and write a handoff.

## Out of scope
- Application code, dependency, migration, authentication, storage, or provider changes.
- Supabase local or remote execution.
- Branch changes, stage, commit, push, or deployment.

## Validation
- `rtk harness status` returned exit 0 and reported state `migrated-v2`, web stack, one current task, and no missing files before this documentation update.
- Compared command names with `package.json` and architecture facts with the source entry points and existing migration plan.
- No tests/build were run because this task changes documentation only.
- Independent read-only review is pending; close only after review or explicit owner instruction.

## Result
Repository-specific map and testing guide are recorded. Current Supabase usage is separated from the approved PostgreSQL target. Independent read-only review approved the architecture, command list, and scope with no actionable findings. Task complete.

## Remaining risk
The app still uses Supabase clients and has no PostgreSQL driver/test path. This task does not migrate or replace those services.

## Follow-up
Create the planned `migration/evolution-go-postgresql-selfhost` HARNESS task, beginning with the baseline/inventory stages already defined in the plan. Preserve `main` and the preexisting dirty checkout.
