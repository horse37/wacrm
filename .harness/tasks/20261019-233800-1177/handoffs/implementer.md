# Implementer handoff — PostgreSQL paginated contact-list read repository

## Start state

- Task `20261019-233800-1177`, status `in_progress`, H-DATA-003 phase 03.
- Repository root is the checked-out Git root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- `C:\Sistemas\zapcrm\wacrm` is absent in this session; use the verified checkout and preserve existing dirty/untracked work.
- PostgreSQL only in task-owned disposable Docker Desktop resources. No Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one server-only page read for `public.contacts`: guard-verified account, transaction-local RLS identity, explicit account scope, exact total count with paginated rows, `Contact` contract projection, case-insensitive substring search over name/phone/email, and stable descending-created order. Escape `%`, `_`, and `\\` so user search text is literal, and bind all values.

Do not wire the page or change contact writes/import/delete, tags, custom fields, Realtime, migrations, permanent grants/RLS, Auth/session, or other domains.

## Validation

Start with failing Vitest. Run focused repository/guard tests, TypeScript, targeted zero-warning ESLint, Prettier, fixture and PowerShell checks, `git diff --check`, and synthetic PG16 forced-RLS integration in disposable Docker Desktop. Use runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, run-only generated passwords, no ports/named volumes, and assert cleanup.

## Next action

Implementation and focused validation are complete. The authorized same-model Luna read-only reviewer returned `APPROVE` with zero findings and caveats for this contact-list repository slice only. Keep task in progress and consumers unwired; continue with the next H-DATA-003 repository read slice: tags.

## Boundaries

- TDD RED confirmed the module was absent. Added `src/lib/repositories/contact-list.ts` for verified account pagination, exact count from one statement snapshot, fixed `Contact` mapping, literal escaped ILIKE search across name/phone/email, and stable descending-created ordering.
- First Docker attempt found invalid SQL escape quoting from JavaScript template-string processing. A unit regression assertion failed before the correction. Final focused Vitest passed 26/26 across contact list, conversation list, message history, and guard; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/whitespace, and `git diff --check` passed.
- Final PG16 disposable Docker proof passed using synthetic data, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/volumes, and `PG_POOL_MAX=1`. Exact counts, past-end pages, order, viewer access, tenant isolation, literal wildcard and case-insensitive email search, generated phone normalization, invalid paging, no session, fail-closed RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261019-233800-1177/validation-postgres-contact-list-315187ad74.log`; earlier failure logs remain preserved; no task resources remain.
- Previous account/profile, WhatsApp config, message-history, and conversation-list slices have limited Luna approvals only. This does not approve H-DATA-003 overall. H-SELF-002, H-DB-003, Supabase/Auth, contact writes, tags/custom fields, Storage, Realtime, app wiring/traffic, and production remain out of scope.
- Reviewer evidence: the Luna reviewer verified task scope/status, main/expected HEAD, parameter binding, literal wildcard escaping, same-statement count/page behavior including empty pages, focused tests, and final disposable PostgreSQL integration evidence; result was `APPROVE`, zero findings, zero caveats. This approval covers only this contact-list slice.
