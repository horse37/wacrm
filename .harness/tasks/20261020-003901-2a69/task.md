# Task — PostgreSQL pipeline deal-list repository

- id: `20261020-003901-2a69`
- type: `migration`
- slug: `postgres-pipeline-deal-list-read`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add a server-only PostgreSQL repository to list board deals for one pipeline in the verified account.

## Context

The pipeline and pipeline-stage read slices each received independent Luna approval limited to that slice. The existing board loads deals newest first with notes, contact, and assigned-profile details. Preserve the edit-form fields plus minimal nested contact/assignee summaries. `contact_id`, `created_at`, and `updated_at` can be nullable in the established schema; preserve those values safely. Keep consumers unwired pending H-SELF-002 and H-DB-003. Use PostgreSQL in disposable Docker Desktop only; no Supabase.

## In scope

- Require verified account membership, validate pipeline UUID, and set transaction-local RLS identity.
- Read deals under explicit verified-account and pipeline scope; require same-account deal creator, pipeline creator, and stage-parent relationships.
- Map board/edit fields including notes, nullable contact/timestamps, date-only close date, bounded numeric value, and same-account optional contact/assignee summaries.
- Preserve newest-first stable order with explicit NULL behavior and ID tie-break.
- Add focused tests and synthetic forced-RLS PostgreSQL proof for account/parent/creator isolation, orphan/cross-account related rows, projection/null/decimal/date mapping, ordering, invalid IDs, empty result, no-session denial, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, deal/pipeline/stage writes, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Independent same-model GPT-6 Luna re-review returned `APPROVE`, zero findings and caveats, for this slice only. Continue to the next narrow PostgreSQL repository slice; keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository module was absent. First independent read-only Luna review found one P2: `updated_at: null` was omitted. The board projection now types and preserves nullable `updated_at`; unit and integration expectations cover the null value.
- After remediation, focused Vitest passed 21/21 across the pipeline deal list, contact deal list, and PostgreSQL account guard. TypeScript (`npx tsc --noEmit`), targeted ESLint (`--max-warnings=0`), and Prettier check passed. PowerShell validation-script AST parsing, fixture whitespace checks, and `git diff --check` passed.
- Final disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports or named volumes, and no residual task resources. Evidence: `.harness/tasks/20261020-003901-2a69/validation-postgres-pipeline-deal-list-dad458f0f4.log`.
- No Supabase, consumer wiring, Auth/session changes, schema/grant/RLS changes, real data/credentials, traffic, or production. Approval remains limited to this slice; task remains `in_progress`.

### Independent re-review — 2026-10-20

- Verdict: `APPROVE`, zero findings and caveats for this slice only.
- The read-only same-model GPT-6 Luna re-review confirmed nullable `updated_at` is represented as `string | null`, explicitly preserved by the mapper, and covered by unit and PostgreSQL integration expectations. It verified the final Docker log and expected branch/HEAD.
- The task remains `in_progress`; this approval does not cover H-DATA-003/H-DB-003 overall, H-SELF-002, Auth, Storage, Realtime, application traffic, or production.
