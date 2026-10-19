# HANDOFF — WACRM continuation

## Session transfer

Repository: `D:\Sistemas\TRAE IA\zapcrm\wacrm`.

The working branch is `main`. This handoff is committed with the current WACRM work before transfer; begin the next session by reading this file, then run only the six Git checks below before editing.

```powershell
rtk git branch --show-current
rtk git rev-parse HEAD
rtk git status --short
rtk git diff --stat
rtk git diff --name-status
rtk git diff --check
```

Do not reset, clean, restore, rebase, switch branches, or discard uncommitted work. Preserve local-only `.claude/`, `.codex/`, and `.serena/` directories unless their owner explicitly requests changes.

## Objective

Current HARNESS task: `20261016-122249401-af84` (`postgres-pool-migration-runner`), status `in_progress`.

It adds a server-side `pg` pool and ordered PostgreSQL migration runner with disposable Docker validation. The task does not migrate WACRM from Supabase, replace Auth/Storage/Realtime, authorize runtime/job data grants, validate against Supabase real, send application traffic to PostgreSQL, or authorize production.

## Completed and committed work

- Historical synthetic secrets were removed from local Git history after an owner-confirmed synthetic-value decision and a verified backup. Remote history publication was authorized in this transfer; use the pushed `main` as the shared continuation point.
- Zap Lead agency integration files, UI, routes, migrations 024–026, heartbeat scripts, planning documentation, and HARNESS records are included in this transfer.
- PostgreSQL pool/runner artifacts include `src/lib/db/`, `scripts/migrate-postgres.mjs`, focused tests, disposable validation scripts, migration 027, and task evidence under `.harness/tasks/20261016-122249401-af84/`.
- Internal GPT-6 Luna review approved the earlier pool/runner correction cycle with zero open findings, limited to that scope.

## Latest external review and exact next action

The newest independent external review returned `REMEDIATION_REQUIRED`; its six findings are not yet fixed:

1. Run a final reproducible Gitleaks directory scan covering untracked task files after freezing edits; label the existing `gitleaks git` result as history-only and remove unsupported cause attribution for the 46-byte host log.
2. Fix the `SET ROLE` ordering assertion so absent calls cannot satisfy `indexOf` ordering.
3. Restore formatting in `scripts/migrate-postgres.test.mjs` and run `prettier --check` for it.
4. Narrow restore claims to a matching manifest and enumerate confirmed omissions: constraints, indexes, sequences, views, function definition/attributes, RLS-enabled flag, schema/table grants, extensions, ownership/datacl status, and relevant trigger scope.
5. Mark superseded validation references and point to `validation-post-review-luna-lock-order-20261018-2015.log` for the post-edit 20/20 unit run.
6. Add a positive nine-digit migration-prefix test, such as `999999999_x.sql`, while keeping invalid/duplicate coverage.

Apply only the smallest corrections, validate the focused tests/Gitleaks as relevant, update `task.md` and `handoffs/implementer.md`, then run the project-required same-model read-only review/correction loop until it returns APPROVE with zero findings and zero caveats. Only after that loop, prepare the prompt for the independent Claude review. Do not claim task-wide approval.

## Evidence and limits

- Historical disposable PostgreSQL validation applied and replay-skipped 27 migrations, exercised selected lock/role/RLS/trigger probes, and compared a restore manifest. It is Docker-only synthetic evidence.
- `npm run test:postgres-migrations` last recorded SUCCESS was 20/20 in `validation-post-review-luna-lock-order-20261018-2015.log` before the newest external findings.
- Pool integration, chain validation, typecheck/lint, full-suite/build and Gitleaks records have scope/time limitations documented in the active task. Do not reclassify historical results as new validation.
- The user requires Docker Desktop disposable resources only, no Supabase local/remoto, VPS, production, real credentials, real customer data, chips, stage/commit/push/deploy unless explicitly authorized.

## Current files and task records

Read first:

- `.harness/current-task.md`
- `.harness/tasks/20261016-122249401-af84/task.md`
- `.harness/tasks/20261016-122249401-af84/handoffs/implementer.md`
- `.harness/tasks/20261016-122249401-af84/compatibility-boundary.md`
- `docs/project-map.md`
- `docs/testing.md`

## Complete continuation prompt

```text
Continue work in D:\Sistemas\TRAE IA\zapcrm\wacrm. Read HANDOFF-CONTEXT.md completely. Then run only:

rtk git branch --show-current
rtk git rev-parse HEAD
rtk git status --short
rtk git diff --stat
rtk git diff --name-status
rtk git diff --check

Confirm branch main and preserve every pre-existing change. Continue HARNESS task 20261016-122249401-af84. The newest external review is REMEDIATION_REQUIRED with six open items: final Gitleaks directory scan of frozen task files; fail-closed SET ROLE ordering assertion; Prettier check; precise restore-manifest limitations; superseded-validation references; and a positive nine-digit migration version test. Make minimal corrections, run focused validation, update task.md and implementer.md, then complete same-model read-only review/correction loops until APPROVE with zero findings and zero caveats. Only then prepare a new independent Claude-review prompt. Do not claim task-wide, Supabase, production, Auth, Storage, Realtime, or H-DB-003 approval. Use Docker Desktop disposable resources only; do not stage, commit, push, deploy, reset, clean, switch branches, or touch local tooling directories without explicit authorization.
```
