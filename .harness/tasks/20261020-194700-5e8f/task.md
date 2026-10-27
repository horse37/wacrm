# Task — PostgreSQL WhatsApp reaction route wiring

- id: `20261020-194700-5e8f`
- type: `migration`
- slug: `postgres-whatsapp-reaction-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire `POST /api/whatsapp/react` to approved PostgreSQL repositories while preserving request responses and Meta-before-persistence ordering.

## Scope

- Keep the existing authenticated-user lookup and per-user rate limit; do not redesign Auth/session policy.
- Use PostgreSQL target lookup, WhatsApp config, and reaction-persistence repositories. Remove route Supabase data queries.
- Preserve 400/404/config/provider responses, decryption, phone sanitization, emoji removal, and persist only after provider success.
- Mock authentication and provider in route tests. Never call real Meta/WhatsApp services.
- When changing the target result contract, update repository tests and rerun its disposable Docker Desktop PostgreSQL 16 forced-RLS integration.

## Out of scope

Auth/session replacement; provider/network changes; schema, RLS, or grant changes; other routes; real credentials/data; Supabase database access; application traffic; production; commit, push, deploy, reset, clean, or branch changes. This slice does not approve H-DB-003 or H-DATA-003 overall.

## Implementation

- `POST /api/whatsapp/react` retains the current server-auth call and rate-limit key/order, then creates the approved PostgreSQL target, config, and persistence repositories using the verified user ID.
- Target lookup now returns nullable provider message ID/contact phone so route can preserve distinct unsent-message and missing-phone responses.
- Provider request remains before local persistence; an empty emoji remains reaction removal. Route tests cover provider and persistence failure responses.
- The target repository integration assertions now expect nullable fields for unsent messages and missing contact phones.

## Validation

See [`validation-focused-20261020.log`](validation-focused-20261020.log). Final focused suite passed 22/22; TypeScript, targeted ESLint with zero warnings, Prettier check, and `git diff --check` passed. Disposable PostgreSQL 16 forced-RLS integration passed; detailed log is recorded in the validation file and source task directory. Expected pre-implementation TDD failures are retained in `validation-red-20261020.log`.

## Review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; record: [`review-gpt6-luna-final-20261020.md`](review-gpt6-luna-final-20261020.md). Approval is limited to this route slice and its evidence; H-DATA-003/H-DB-003 remain in progress.

## Next action

Proceed to the next narrow route slice: wire `POST /api/flows/[id]/activate` to the already-approved flow status-transition repository, keeping PUT/DELETE and unrelated behavior out of scope.

## Handoff limits

Only disposable Docker Desktop PostgreSQL with synthetic fixtures is permitted. No Supabase database or live provider access. Keep H-DB-003/H-DATA-003 in progress; no commit, push, or deploy.
