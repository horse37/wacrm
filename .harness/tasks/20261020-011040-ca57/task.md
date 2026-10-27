# Task — PostgreSQL pipeline deal details update

- id: `20261020-011040-ca57`
- type: `migration`
- slug: `postgres-pipeline-deal-details-update`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository operation for editing a deal's form fields in the verified account.

## Context

Pipeline list, stage list, deal list, stage move, status update, and deal creation have independent approvals limited to their slices. Existing `DealForm.handleSave()` edits title, value, currency, contact, stage, assignee, notes, and expected close date. Migration 017 requires minimum role `agent` for deal updates. Use disposable PostgreSQL on Docker Desktop only; no Supabase. Consumers remain unwired pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership and minimum `agent`; validate deal, pipeline, stage, contact, optional assignee, value, currency, title, notes, and date.
- Scope deal to verified account and supplied existing pipeline; do not change `pipeline_id`, `account_id`, creator, or status.
- Require same-account deal/pipeline creators, target stage in the deal's pipeline, and same-account contact/optional assignee.
- Set transaction-local RLS identity and update only form fields with parameterized SQL; return safe not-found for inaccessible rows.
- Test authorization, relation/tenant isolation, input validation, parameterization, only allowed column writes, timestamp trigger, and pooled identity cleanup.

## Out of scope

No UI/API wiring, create/status/delete operation, Auth/session replacement, schema/migration/grant/RLS changes, other repositories, Supabase, Storage, Realtime, real credentials/data, existing Docker resources, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Disposable PostgreSQL 16 Docker Desktop with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, column-only UPDATE grants, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.
- Fresh independent same-model GPT-6 Luna read-only review; remediate and repeat until APPROVE with zero findings and caveats.

## Next action

Implementation and focused validation are complete. TDD RED confirmed the module was absent; the repository and seven focused unit tests now pass. The repository updates only the eight form columns, derives account/user from the verified session, requires `agent`, scopes all relations to the account, and preserves deal creator, pipeline, and status.

Focused repository plus account-guard Vitest passed 15/15. TypeScript passed; targeted ESLint passed with zero warnings; Prettier check, PowerShell AST/fixture least-privilege checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, only eight column-level UPDATE grants, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual resources. Final evidence: `validation-postgres-pipeline-deal-details-update-f135cd2ed5.log`. The initial runner attempt retained the prior slice's role name and failed before integration, with no residual resources; its log is `validation-postgres-pipeline-deal-details-update-14215ec811.log`. The runner role name was corrected before the successful final run.

Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats, limited to this slice. Keep the task `in_progress` and consumers unwired. Next narrow deal operation: inspect and implement the existing deal delete flow, with the role and relational effects explicitly tested.

No Supabase, UI/API wiring, Auth/session replacement, schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, or deploy occurred. H-DATA-003/H-DB-003 are not approved overall.

## Independent read-only review

Fresh same-model GPT-6 Luna reviewer returned exactly `APPROVE` with zero findings and zero caveats for this deal-details update slice. The review did not approve H-DATA-003/H-DB-003 overall, consumer wiring, Auth/session, Supabase, or production.
