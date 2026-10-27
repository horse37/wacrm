# Current task

- id: 20261023-004958-ea9f
- type: migration
- slug: postgres-zap-lead-heartbeat-writes
- status: complete para esta fatia (sem commit)
- goal: migrate only the three Zap Lead heartbeat write helpers to a server-only PostgreSQL repository; preserve boolean, credential-generation, alert-idempotency, and error behavior.
- roadmap: H-DATA-003, phase 03
- previous slice: 20261022-235737-7a9c complete; internal and independent GPT-6 Luna reviews APPROVE, zero findings/caveats, limited to SSE receipt persistence.
- previous full-tree task: 20261021-113450-6f2c remains in_progress; Opus 5.5 r2 is REMEDIATION_REQUIRED and awaits owner's new review.
- implementation: complete in working tree; three server-only PostgreSQL calls and focused regressions added, without migration/schema/RLS/permanent-grant changes.
- validation: Vitest 17/17, TypeScript, focused ESLint, Prettier, Node and PowerShell syntax, disposable PostgreSQL 16 integration, and `git diff --check` passed. Final PostgreSQL evidence: `.harness/tasks/20261023-004958-ea9f/validation-postgres-zap-lead-heartbeat-writes-1cb268598b.log`; the earlier combined attempt `.harness/tasks/20261023-004958-ea9f/validation-postgres-zap-lead-heartbeat-writes-31574ba583.log` is superseded because its later Vitest run failed.
- review: internal and independent GPT-6 Luna both APPROVE, zero findings/caveats, limited to these three heartbeat writes; reports in `.harness/tasks/20261023-004958-ea9f/`.
- next action: inspect remaining H-DATA-003 phase 03 PostgreSQL migration candidates and start the next narrow slice.
- boundaries: no Supabase service calls, external health traffic, real data/credentials, VPS/production, persistent database, migration/schema/RLS/permanent-grant changes, commit/push/deploy. Disposable Docker Desktop PostgreSQL only. H-DATA-003 and H-DB-003 are not globally approved.
