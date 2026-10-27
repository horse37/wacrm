# Project map — WACRM

## Current runtime

- Next.js App Router pages and handlers live in `src/app/`; `src/middleware.ts` applies request-level routing/auth checks.
- Browser and server Supabase clients are created in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`.
- `src/lib/auth/` contains account, role, and invitation helpers. Many pages and API routes query Supabase directly through the client.
- WhatsApp currently uses Meta Cloud API modules in `src/lib/whatsapp/`; inbox and live updates also rely on Supabase Realtime.
- Product areas include contacts, inbox, pipelines, broadcasts, automations, flows, media storage, settings, and the Zap Lead integration in `src/lib/zap-lead/`.

## Data path

The current app uses Supabase for PostgreSQL access, Auth, RLS, Storage, and Realtime. This describes the code at the inspected HEAD; it is not the target architecture.

The existing plan `plano-de-acao/plano-de-acao-evolution-go-postgresql.html` targets Evolution GO plus self-hosted PostgreSQL and requires replacing the Supabase-provided services in small, validated slices. PostgreSQL self-host is the required database target. Do not start Supabase locally or remotely, and do not assume that PostgreSQL alone replaces Auth, RLS, Storage, or Realtime.

## Migration entry points

- Supabase clients: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`.
- Auth and account boundaries: `src/lib/auth/`, `src/middleware.ts`, auth pages under `src/app/(auth)/`.
- API handlers: `src/app/api/`; direct Supabase consumers must be inventoried by domain before migration.
- WhatsApp provider: `src/lib/whatsapp/meta-api.ts` and related modules; Evolution GO is the plan target.
- Zap Lead integration: `src/lib/zap-lead/` and `src/app/api/zap-lead/`.
- Automated checks and scripts are declared in `package.json`; see `docs/testing.md`.

## Constraints

- Keep existing behavior while replacing one provider/data boundary at a time.
- Define account isolation and authorization before replacing RLS.
- Every account-owned domain read or write must be scoped to the verified account ID in SQL; never query or mutate domain data without account scope.
- Plan explicit replacements for Auth, Storage, and Realtime; self-hosted PostgreSQL covers the database only.
- Do not migrate or remove an integration without an existing approved task and rollback/validation notes.
