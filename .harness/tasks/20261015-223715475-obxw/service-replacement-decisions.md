# H-DB-003 — service replacement proposal

**Status:** reviewed planning direction; implementation remains gated on disposable Docker validation and an approved ADR. No service was replaced in this task.
**Database:** self-hosted PostgreSQL only. Supabase local and remote are out of scope.

## Auth and sessions

**Proposal: Better Auth with the PostgreSQL adapter, email/password authentication, and PostgreSQL-backed sessions.** Keep the CRM's account, membership, and role model in application-owned tables; do not introduce an organization plugin until mapping its semantics against current account membership is reviewed. Better Auth uses database sessions by default; do not enable secondary session storage or JWT cookie caching for authorization decisions.

The current WACRM login uses email/password. Signup verifies email and preserves an invitation token through the verification redirect. The settings page requires the current password before changing it. As a historical comparison only, not a current recommendation, Auth.js documentation states that its Credentials provider does not persist users and is supported only with JWT sessions; that would require maintaining password storage and session revocation separately. Better Auth's current documentation describes a PostgreSQL pool adapter, email/password, verification/reset callbacks, and revocable database sessions. This better fits the existing flow and supports server-side session revocation.

Requirements before implementation:

- Keep the PostgreSQL pool server-only and the auth secret in deployment secrets.
- Preserve user UUIDs where possible so existing profile and membership references remain stable.
- Verify password-hash compatibility in a disposable fixture before migrating any hash. If it cannot be proven, require password reset instead of weakening hash checks.
- Preserve verified-email and invitation acceptance rules. Implement password-reset and verification delivery through a replaceable SMTP adapter; use a local mail sink in Docker. No SMTP credential is available or required for this design step.
- Revoke active sessions on password reset and provide server-side revocation for account/user disablement. Verify revocation behavior against PostgreSQL in the focused Docker integration tests.
- Define cookie and request protections before implementation: `HttpOnly`, `Secure` in hosted HTTPS, an explicit `SameSite` policy, trusted-origin checks, and CSRF protection for cookie-authenticated mutations. Set documented idle and absolute session lifetimes and rotation rules. Revoke sessions after password change/reset, user disablement, account removal, or a role change that reduces access. Add focused tests for each lifecycle transition, invitation/verification token expiry and replay, and rejected cross-origin mutations.

## Account authorization and former RLS duties

**Proposal: application-layer authorization on the server, with no PostgreSQL connection from browser code.** Move queries and mutations behind server-only repositories and route/server-action boundaries. Every operation must derive the authenticated user and active account from the server session, verify membership/role, and include the account scope in the SQL predicate. Keep role and account-membership data in app-owned tables. Do not trust account IDs, user IDs, roles, or object paths supplied by the browser.

Retain application-layer authorization and add PostgreSQL RLS as defense in depth for account-scoped tables. Derive the active account only from the verified server session; set it with a transaction-local setting after beginning each transaction, and fail closed when the setting is absent. Runtime and job roles must not have `BYPASSRLS`; policies must cover reads and writes, including `WITH CHECK`. Test cross-account denial, missing context, account switching, and pooled-connection reuse to prove context cannot leak between requests. Do not remove a Supabase policy or client path until its PostgreSQL policy, replacement endpoint, and negative tests are in place.

## Storage

**Proposal: MinIO-compatible S3 storage for hosted self-hosting.** Keep object bytes outside PostgreSQL, namespace keys by account and media owner, and mediate all reads/writes through server code with membership checks. Use short-lived signed URLs only when the UI requires direct transfer. Docker uses a disposable MinIO service and synthetic media; preserve existing volumes. Filesystem storage is not the default because it complicates multi-container deployments and backup ownership.

## Realtime

**Proposal: authenticated polling for the first self-hosted slice.** Poll only the currently visible inbox/unread views, stop or slow polling for hidden tabs, and keep cursor/time-window queries bounded. This avoids introducing a new event broker while the data-access boundary is moving. Add SSE or PostgreSQL LISTEN/NOTIFY only after measuring polling load and defining reconnect, replay, and authorization behavior.

## Elevated jobs and webhooks

Use an isolated server-only job database client backed by the restricted role from H-DB-002. Maintain an explicit role/table/operation grant matrix and separate credentials/pool from normal requests. The role must not be a table owner or bypass RLS; each job must set transaction-local account context and pass the same account-scope checks. Add an import-boundary check proving browser bundles and normal request modules cannot reach the elevated client. Never use PostgreSQL superuser credentials in the app. Webhook and scheduled-job effects remain idempotent, scoped to account, and audited. Keep public request handlers on the normal runtime role.

## Migration and validation order

1. Preserve the current provider while adding a disposable PostgreSQL Docker path and proving migrations, pooling, backup/restore, and synthetic fixtures.
2. Introduce the server-only PostgreSQL repository boundary and cross-account tests before replacing browser Supabase data access.
3. Migrate authentication and account/session enforcement in a narrow vertical slice; verify email, password reset/change, invitation flows, session revocation, and role checks.
4. Move storage to MinIO and switch Realtime to bounded polling in separate slices.
5. Retire Supabase paths only after each corresponding consumer has migrated and tests pass.

No production cutover, password hash migration, real mail delivery, real WhatsApp chip, or existing Docker volume is part of these proposals.

## Official documentation checked — 2026-10-16

Context7 resolution/query was attempted, but its result was opaque. The following primary documentation was fetched directly from the Better Auth repository at commit e5b971444a28efd8cafb1ffb39160661a15bb56c and read during the prior session; links pin that same snapshot and do not approve implementation or application session policy:

- PostgreSQL adapter and `pg` `Pool` configuration example: https://github.com/better-auth/better-auth/blob/e5b971444a28efd8cafb1ffb39160661a15bb56c/docs/content/docs/adapters/postgresql.mdx
- Email/password, verification, and password-reset callbacks: https://github.com/better-auth/better-auth/blob/e5b971444a28efd8cafb1ffb39160661a15bb56c/docs/content/docs/authentication/email-password.mdx
- Session storage, expiry/refresh defaults, session revocation, cookie cache, and stateless mode: https://github.com/better-auth/better-auth/blob/e5b971444a28efd8cafb1ffb39160661a15bb56c/docs/content/docs/concepts/session-management.mdx
- Auth.js Credentials provider constraints (historical comparison only): https://authjs.dev/getting-started/providers/credentials
- Existing project recommendations and order: `plano-de-acao/plano-de-acao-evolution-go-postgresql.html`, H-DB-002 and H-DB-003.

Verified Better Auth facts relevant to this proposal: its session-management documentation says sessions are stored in the database by default when a database is configured; configured secondary storage changes the default session location, and omitting a database enables stateless mode. The documented default expiry is seven days, refreshed when `updateAge` is reached; its example sets `updateAge` to one day. These defaults are not an approved WACRM policy. The docs do not set this application's absolute maximum lifetime or token-rotation policy, so those remain undecided.

## Session lifetime decision status — 2026-10-16
No WACRM-specific idle/absolute session lifetime or token-rotation interval is selected in this design. Better Auth defaults are documented above, but they are not an approved app policy. Before authentication implementation, choose and justify the app policy, then add lifecycle/expiry/revocation tests. Do not infer an absolute maximum or token rotation from the library's documented rolling expiry defaults.
