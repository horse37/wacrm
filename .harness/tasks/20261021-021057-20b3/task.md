# Task — consulta PostgreSQL de conversa/contato no envio WhatsApp

- id: `20261021-021057-20b3`
- type: `migration`
- slug: `postgres-whatsapp-send-conversation-contact-lookup`
- status: `completed`
- roadmap: H-DATA-003, phase 03

## Goal

Replace only the account-scoped conversation/contact lookup in `POST /api/whatsapp/send` with PostgreSQL access, preserving route responses and all remaining operations.

## Context

The preceding account-guard slice was independently approved. The route still reads local conversation/contact data through PostgREST. Existing PostgreSQL conversation-list code is not a single-conversation send lookup; inspect whether it can safely be reused or add a minimal tenant-scoped repository.

## In scope

- Read the conversation and its joined contact by `conversation_id` and verified `account_id`.
- Preserve 404 when the conversation is unavailable and 400 when its contact has no usable phone.
- Add focused tests with synthetic fixtures and no external service calls.

## Out of scope

Other `POST /api/whatsapp/send` queries/writes, Auth/session, Meta/WhatsApp calls, Supabase Auth, schema/RLS/grants, Storage, Realtime, VPS, production, real data/credentials, commit, push, and deploy. H-DATA-003/H-DB-003 are not globally approved.

## Validation

Focused Vitest 8/8 (including no-contact, contact-without-phone, and invalid-phone cases), TypeScript, targeted ESLint zero warnings, Prettier for test/repository/integration script, `git diff --check`, and PostgreSQL 16 disposable Docker integration passed. Details: `validation-final-20261021.log`; database evidence: `validation-postgres-whatsapp-send-conversation-9445f40974.log`. Full legacy `route.ts` Prettier baseline remains documented and untouched. Internal read-only and independent GPT-6 Luna reviews returned APPROVE, zero findings and zero caveats; reports: `review-internal-remediation-20261021.md` and `review-gpt6-luna-final-20261021.md`. Approval is limited to this slice; H-DATA-003/H-DB-003 remain unapproved globally.


## Result

This conversation/contact lookup slice received internal and independent GPT-6 Luna read-only `APPROVE`, zero findings, and zero caveats. Focused Vitest passed 8/8; TypeScript, targeted zero-warning ESLint, Prettier, `git diff --check`, and disposable PostgreSQL 16/RLS evidence are recorded in this task directory.

Remaining risk: other database operations in `POST /api/whatsapp/send` remain outside this slice. H-DATA-003/H-DB-003 remain unapproved globally. Follow-up: task `20261021-025715-4b73` for the separate reply-target lookup.
## Limits

Only disposable PostgreSQL in Docker Desktop. No Supabase local/remote, VPS, production, real traffic, credentials, customer data, or real Meta/WhatsApp sends. Preserve all pre-existing local work; no destructive Git operations. Stop at 09:00 BRT on 2026-10-22.
