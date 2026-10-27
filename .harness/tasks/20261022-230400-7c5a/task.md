# Task — Persistência PostgreSQL do recibo de webhook Zap Lead

- id: `20261022-230400-7c5a`
- type: `migration`
- slug: `postgres-zap-lead-webhook-receipt-write`
- status: `complete` for this migration slice; independent review approved with zero findings and zero caveats.
- roadmap: H-DATA-003, phase 03

## Goal

Replace only the Supabase RPC call that accepts a Zap Lead webhook receipt with a server-only PostgreSQL call to the existing, parameterized `public.accept_zap_lead_webhook_event` function. Preserve `accepted`, `duplicate`, `replay`, and `invalid` results and generic failure behavior.

## Context

The preceding H-DATA-003 slice migrated webhook credential lookup to PostgreSQL. `src/lib/zap-lead/events.ts` still calls Supabase for webhook receipt acceptance. The endpoint remains fail-closed behind `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED`; `wacrm_runtime` execution grants and the full H-DB-003 privilege matrix are not approved or provisioned.

## In scope

- Add a server-only repository method that calls the existing PostgreSQL function through `withTransaction` and bound parameters.
- Route `acceptZapLeadWebhookEvent` through that method; preserve all other Zap Lead RPC helpers and route behavior.
- Add focused regression tests and an integration proof against the checked-in function on disposable PostgreSQL.
- Record that temporary test grants prove function behavior only, not production/runtime readiness.

## Out of scope

- Enabling or changing the webhook gate; enabling endpoint runtime.
- Changing migrations, function ownership/body, schema, RLS, grants, or any persistent database.
- Migrating SSE, heartbeat, registration, Auth, or other domains in this slice.
- Supabase service access, external webhook traffic, VPS, production, real data/credentials, commit, push, or deploy.

## Validation

- TDD for the repository call, accepted statuses, invalid result, and database error.
- Focused Vitest, TypeScript, focused ESLint, Prettier, Node/PowerShell syntax, and `git diff --check`.
- PostgreSQL 16 disposable Docker Desktop proof for accepted, duplicate event, replay nonce, invalid account/key, and transaction rollback/cleanup where applicable. Use synthetic data and task-owned resources only.

## Implementation and validation — 2026-10-22

- Added server-only repository that calls the existing function with six bound values inside `withTransaction`; `acceptZapLeadWebhookEvent` now uses it. Other Supabase RPC helpers are unchanged.
- TDD red recorded at `tdd-red-postgres-zap-lead-webhook-receipt-20261022.log`; final focused Vitest passed 13/13.
- TypeScript, focused ESLint (`--max-warnings=0`), Prettier, Node syntax, PowerShell parser, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker Desktop proof applied migrations 001–028, then exercised accepted, duplicate, replay, account/key mismatch, invalid event rollback/retry, and cursor ordering. Evidence: `validation-postgres-zap-lead-webhook-receipt-65cd1e618f.log`.
- The first integration attempt exposed that runtime does not have permission to read event-state details; the proof now inspects persisted state through the disposable bootstrap connection without widening runtime privileges. Failed attempt is preserved in `validation-postgres-zap-lead-webhook-receipt-cae36445ae.log`.
- The only `EXECUTE` grant was temporary inside the disposable database. It does not provision runtime privileges or approve H-DB-003. Webhook gate, migrations, schema, RLS, grants, and persistent databases were not changed.

## Review

- Internal read-only review: approved, zero actionable findings; `.harness/tasks/20261022-230400-7c5a/review-internal.md`.
- Independent GPT-6 Luna first pass: `REMEDIATION_REQUIRED` for the stale Supabase comment in `src/app/api/zap-lead/webhook/route.ts`; record `.harness/tasks/20261022-230400-7c5a/review-independent.md`.
- Remediation: corrected the comment to describe PostgreSQL credential/receipt paths and clarify that the gate does not provision runtime `EXECUTE` privileges.
- Independent GPT-6 Luna re-review: `APPROVE`, zero findings and zero caveats for the corrected comment. The record explicitly limits approval to that correction.
- Independent GPT-6 Luna re-review: `APPROVE`, zero findings and zero caveats for the corrected comment; approval and exact scope in `.harness/tasks/20261022-230400-7c5a/review-independent.md`.

## Closeout

Result: this narrow webhook-receipt migration slice is complete; only its delta was independently approved.

Validation: implementation checks and PostgreSQL 16 disposable proof passed; after the comment correction, focused event tests passed 6/6, Prettier check passed, and `git diff --check` passed.

Remaining risk: runtime `EXECUTE` privileges and H-DB-003 matrix are not approved/provisioned; webhook remains gated. Full-tree Opus 5.5 r2 remains `REMEDIATION_REQUIRED`, and H-DATA-003/H-DB-003 are not globally approved.

Follow-up: migrate only `recordZapLeadSseEvent` to a server-only PostgreSQL repository in task `20261022-235737-7a9c`.
