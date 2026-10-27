# Independent review request — PostgreSQL automation due-execution claim

Task: `20261020-074348-a853`, branch `main`, expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. Repository: `C:\Sistemas\wacrm`.

Review read-only for this slice only:

- `src/lib/repositories/automation-pending-claim.ts`
- `src/lib/repositories/automation-pending-claim.test.ts`
- `scripts/testing/postgres-automation-pending-claim-integration.mjs`
- `.harness/tasks/20261020-074348-a853/postgres-automation-pending-claim-fixture.sql`
- `.harness/tasks/20261020-074348-a853/task.md` and `handoffs/implementer.md`

Check transaction correctness, date/limit validation, returned-field projection, malformed database values, deterministic ordering, concurrent claims, and the Docker Desktop PostgreSQL forced-RLS/minimal-grant proof. The implementation is intentionally not wired into the cron route or engine. Do not propose or attribute schema, grant, runtime-role, Auth, or consumer changes to this slice. H-DATA-003/H-DB-003 remain unapproved overall.

The worktree contains many pre-existing dirty and untracked slices; do not attribute unrelated files against HEAD to this task. Do not edit, run mutating commands, change branch, commit, push, or deploy. Persistence/validation must not use Supabase or external PostgreSQL; the recorded proof is disposable PostgreSQL 16 in Docker Desktop only, with synthetic data and cleanup.

Initial review found one P2 because known `AutomationContext` fields were not type-checked. The remediation validates optional string fields and the `vars` object and adds malformed-row tests; record: `review-remediation-20261020.md`.

Post-remediation evidence: final Docker result `validation-postgres-automation-pending-claim-2d823a0f3a.log`; focused Vitest 14/14; TypeScript; targeted ESLint with zero warnings; targeted Prettier; `git diff --check`.

Return exact verdict and counts. Use `APPROVE` only when findings = 0 and caveats = 0. Otherwise list actionable findings with severity and evidence; wait for remediation before rereview.
