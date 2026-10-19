# Current task
- id: 20261016-122249401-af84
- type: migration
- slug: postgres-pool-migration-runner
- preset: full
- status: in_progress

## Goal
Add a server-side `pg` pool (usage convention; no automated import guard) and ordered migration runner; prove the actual WACRM migration chain in disposable Docker PostgreSQL.

## Context
The prior task `20261015-223715475-obxw` is closed for inventory and reviewed planning only. Its independent read-only review approved the H-DB-002/H-DB-003 direction as a proposal and confirmed the restore-role correction. This does not approve service migration or production deployment.

## Scope
- Inventory/classify existing migration SQL before editing.
- Implement server-side pool (usage convention; no automated import guard) and runner with ordered history, lock, replay safety, and fail-closed errors.
- Validate actual migration chain, concurrency, failure recovery, roles/grants, and restore assumptions in isolated Docker PostgreSQL.
- Keep application consumers, Auth, Storage, and Realtime unchanged.

## Completed first action — read-only migration inventory
Inventory and marker classification are recorded in .harness/tasks/20261016-122249401-af84/migration-inventory.md. No SQL/app files were edited.

## Superseded checkpoint — prior next action (2026-10-18)
The checkpoint below records the state before the owner's synthetic-value confirmation and local history cleanup. It is superseded by the 2026-10-18 updates at the end of this file.

Historical next action: rotate credentials if needed and authorize local history cleanup. The owner later confirmed the historical values were synthetic and authorized local-only cleanup after backup.

## Restrictions
Preserve dirty worktrees and all existing containers/volumes. Use task-owned Docker resources only, with `--network none`, tmpfs, and `--rm`. No Supabase, VPS, production, homologation, real customer data/chips, branch switch, stage, commit, push, or deploy.


## Update — local historical Gitleaks findings (2026-10-18)
The owner confirmed `META_APP_SECRET` and `ENCRYPTION_KEY` in the historical examples were synthetic and authorized a local-only history rewrite after backup; no rotation or push was authorized. The backup at `D:\Sistemas\TRAE IA\zapcrm\wacrm-backup-20261018-filter` was created and verified; its full-history bundle verification passed again this session. The prior full-copy comparison recorded zero differences.

A fresh temporary mirror was filtered with git-filter-repo 2.47.0, replacing the two exact synthetic values from the three reported historical lines. The filter covered `refs/heads/main` and `refs/remotes/origin/main`; the Codex checkpoint ref is a tree object, not a commit, and its tree has no `docs/environment-variables.md`, so it was preserved unchanged. Original local refs now point to `029d4b42dc06999044d72c6c234c68e85b8798e7`; branch remains `main`, `origin/HEAD` remains symbolic, HEAD tree and all 141 dirty status entries are unchanged.

Gitleaks 8.21.2 in Docker (`--network none`, read-only mount) passed on the mirror and primary checkout: exit 0, 232 commits scanned, no leaks. Reflogs expired and `git gc --prune=now` passed; the two finding commits and old HEAD (three objects total) are absent from the active object database, and `git fsck --unreachable` found zero objects. No functional tests were run. No stage, commit, or push occurred. The actual remote was not changed; fetching from it before coordinated server-side cleanup could reintroduce the old history.

Independent read-only review approved the local history cleanup with zero open findings, limited to that cleanup and its records. The reviewer found no raw Gitleaks logs; both scans remain executor-recorded evidence. The overall PostgreSQL migration task remains `in_progress` and is not approved. Superseded by the 2026-10-18 review remediation below: this remediation step was executed. Its next action is the independent re-review. Direct runtime/job grants remain limited to CONNECT; effective PUBLIC defaults are not denied by that policy.

## Review remediation — 2026-10-18
F1–F5 corrections are recorded in the task and implementer handoff. The final disposable PostgreSQL runner passed with all 27 migrations applied and replay-skipped, selected ACL and trigger probes passing, and restore manifest matching. Gitleaks 8.21.2 passed on the rewritten history: 232 commits, no leaks; executor-recorded summary in the task log; raw Gitleaks output not preserved. The first two trigger-probe attempts failed on synthetic fixture shape and were corrected; their logs remain preserved. No app typecheck, lint, build, or pool Vitest was rerun in this step. Later on 2026-10-18 typecheck, lint (0 errors) and pool Vitest 13/13 passed in a Linux container (`validation-pool-verify-20261018.log`); build and full suite were not run. The overall task remains `in_progress` and unapproved. Next action is an independent read-only re-review of F1–F5 and validation records.