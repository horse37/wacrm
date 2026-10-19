# WACRM provider/database inventory — 2026-10-16

## Baseline

Current dirty checkout was run from an isolated `node:20-bookworm` Docker container. The source checkout was mounted read-only, copied into an exec-enabled `tmpfs`, dependencies were installed there with `npm ci --no-audit --no-fund`, and no `.env` files were copied. No Supabase instance or application service was started.

- `npm ci --no-audit --no-fund`: SUCCESS (container prerequisite).
- `npm test` (`vitest run`): SUCCESS, exit 0. The command wrapper did not preserve the Vitest case count.
- `npm run typecheck` (`tsc --noEmit`): SUCCESS, exit 0.
- The initial run against preexisting host `node_modules` failed with missing `@vitest/utils` and TypeScript package/type errors. A first clean install attempt used a no-exec tmpfs and failed to launch `napi-postinstall` (126); the final run used an exec-enabled tmpfs and clean install.

The passing baseline is for the existing dirty checkout, not a clean `HEAD` comparison. It is not evidence of PostgreSQL runtime behavior.

## Current-state inventory

Counts are files with source matches, not call counts. Categories overlap.

| Boundary | Files | Representative paths | Current behavior |
|---|---:|---|---|
| Supabase Auth / client construction | 40 | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts`, `src/hooks/use-auth.tsx`, auth pages, account/member/invitation APIs | Browser/server clients and session/Auth APIs are consumed across UI and routes. |
| Direct Supabase data APIs (`from`, `rpc`, `schema`, `functions`) | 21 | contacts, pipelines, broadcasts, flows, automations, account/invitations, WhatsApp routes, `src/lib/zap-lead/credentials.ts` | Query logic is distributed between UI and API handlers; RLS currently provides part of account authorization. |
| Supabase Storage | 2 | `src/lib/storage/upload-media.ts`, `src/app/api/whatsapp/media/[mediaId]/route.ts` | Upload/download path is coupled to Supabase Storage. |
| Supabase Realtime | 3 | `src/hooks/use-realtime.ts`, `src/hooks/use-total-unread.ts`, `src/app/(dashboard)/inbox/page.tsx` | Inbox and unread counts subscribe to Postgres change events. |
| Meta Cloud API | 16 | `src/lib/whatsapp/meta-api.ts`, `src/lib/flows/meta-send.ts`, `src/lib/automations/meta-send.ts`, `src/app/api/whatsapp/*` | Sending, webhooks, templates, media and broadcasts use Meta-specific contracts. |

Search basis: `rtk rg -l --glob '!**/*.test.*'` over `src` with patterns `supabase\.auth|@supabase/ssr`, `supabase\.(from|rpc|schema|functions)\(`, `supabase\.storage|storage\.from\(`, `postgres_changes|supabase\.channel|\.channel\(`, and `meta-api|graph\.facebook\.com|META_[A-Z_]*(TOKEN|URL)|Meta Cloud API`.

## Database readiness

- `package.json` includes `@supabase/ssr` and `@supabase/supabase-js`; it has no `pg` driver or PostgreSQL integration-test script.
- Supabase client factories are in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`; direct consumers must be assigned to domain owners before replacing them.
- PostgreSQL alone does not replace Auth, RLS, Storage, or Realtime. The original plan historically mentioned Auth.js; that recommendation is superseded by the current H-DB-003 proposal in service-replacement-decisions.md: Better Auth and PostgreSQL-backed sessions, alongside MinIO-compatible storage, bounded polling, server-side authorization, and PostgreSQL RLS defense in depth. This remains a proposal pending independent review. Better Auth primary docs were checked on 2026-10-16; library defaults are recorded there, but no app-specific session policy was approved.
- The plan's order is H-DB-001 inventory, H-DB-002 PostgreSQL design, H-DB-003 service replacements. No implementation was made in this baseline/inventory step.

## Risks and next action

Auth/RLS account isolation is the highest risk because many client components query directly. Storage and Realtime also have consumers outside the API layer. Start the next slice with the H-DB-002 design and an ADR that fixes account isolation, session handling, migrations, pooling, storage ownership, and polling/realtime semantics before changing service code.

## Continuation review (2026-10-16)

- Read-only search in the current dirty checkout reproduced the recorded counts: Auth/client construction 40 files, direct data APIs 21, Storage 2, Realtime 3, Meta provider 16. These categories can overlap and represent files, not call totals.
- Serena confirmed `src/lib/supabase/server.ts` exports the `createClient` factory and references include account, automation, flow, invitation, and WhatsApp route modules. The browser factory is in `src/lib/supabase/client.ts`.
- Plan review confirms H-DB-002 covers PostgreSQL host/port/database/schema/app user, pool, migrations, backup, restore, and disposable PostgreSQL tests. Auth, RLS, Storage, and Realtime replacement choices belong to H-DB-003 and must remain explicit rather than being implied by PostgreSQL.
- Ruflo's read-only reviewer agent `agent-1792115629947-lw1jvv` could not execute: `No LLM provider configured`. No independent review approval is claimed. The current session's review was inspection-only.
- The baseline results above are inherited from the prior Docker run; they were not rerun in this continuation. No PostgreSQL runtime behavior is established by the TypeScript/Vitest baseline.

**Next action:** retry independent read-only review when Ruflo has a configured LLM provider. The attempt on 2026-10-16 used swarm swarm-1792154381637-sw32v1, task task-1792154386488-5yv3z1, and reviewer agent-1792154434703-undsvr; it failed with No LLM provider configured, and the task is blocked. After independent approval, define a separate disposable Docker PostgreSQL task for the actual WACRM migration chain, runner replay/concurrency/failure recovery, pool reuse, role grants, account isolation, and dump/restore. Do not migrate application consumers in this design task.
