# Implementer handoff — PostgreSQL invitation redemption repository

## Start state

- Task: `20261019-225656-ca32`, `postgres-invitation-redemption-repository`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all pre-existing dirty work and evidence. No commit, push, or deploy.
- PostgreSQL only in task-owned disposable Docker Desktop resources; no Supabase.

## Scope boundary

Implement one server-only repository method that verifies a caller through the existing PostgreSQL account guard, sets that verified identity transaction-locally, accepts only a SHA-256 digest, and calls migration 019's existing `public.redeem_invitation` using a bound value. The RPC alone owns invite locking, the all-domain no-data-loss guard, profile movement, acceptance, and empty personal-account cleanup. Do not edit the route, migration, permanent grants, Auth/session policy, or add direct data mutations.

## Context and next action

- The invitation-preview repository slice received independent same-model Luna `APPROVE`, zero findings/caveats, limited to that slice.
- Existing migration 019's RPC checks 11 domain tables: `contacts`, `conversations`, `broadcasts`, `automations`, `flows`, `pipelines`, `message_templates`, `tags`, `custom_fields`, `contact_notes`, and `whatsapp_config`.
- Implemented `src/lib/repositories/invitation-redemption.ts`; it guards the verified caller, accepts only a digest, transaction-locally sets identity, calls the existing RPC with a bound parameter, validates UUID output, and exposes only safe mapped errors. `22023` maps to `bad_request`; `23505` maps to `conflict`.
- TDD RED failed because the module was absent and the `22023` mapping was not defined. Focused Vitest passed 91/91 across 12 files; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell parse, and task-file whitespace checks passed.
- Disposable PostgreSQL 16 Docker proof passed with synthetic rows, `NOBYPASSRLS`, no direct invitation/domain table grants, `--network none`, tmpfs, read-only repository mount, no ports/volumes. It verified success, invalid/replayed invitations, conflict paths, all 11 domain-data guards preserving rows, and transaction-local identity cleanup. Evidence: `../validation-postgres-invitation-redemption-252f5dda1d.log`; no task resources remain.
- Two interim Docker runs caught and fixed test-proof issues: an RLS-protected profile read lacked identity, and two fixture digests were outside hexadecimal. Failed logs remain for traceability; final run passed.
- No route, migration 019, Auth/session provider/policy, permanent grant/RLS, or Supabase code changed. No commit, push, or deploy.

## Next action

Same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this repository slice. Select the next safe PostgreSQL repository slice from the approved project plan. Keep route unwired and this task `in_progress`; H-DB-003, H-SELF-002, and overall HARNESS approval remain open.
