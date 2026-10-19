# Handoff — WACRM HARNESS adoption

## Repository
- Path: `D:\Sistemas\TRAE IA\zapcrm\wacrm`
- Branch: `main`
- HEAD: `e714fb0db5cd60cc797534a3e8d7c53e9986aac1`
- Working tree was already dirty before this documentation work. Preserve all tracked/untracked changes and local artifacts.

## Objective and result
Complete the existing adoption task by documenting WACRM architecture and validation commands before the planned Evolution GO/PostgreSQL migration.

Updated `docs/project-map.md` to distinguish current Supabase implementation from the PostgreSQL self-host target, map key modules, and state explicit replacement requirements for Auth, RLS, Storage, and Realtime. Updated `docs/testing.md` with package scripts, test limitations, and Docker-only synthetic validation rules.

## Validation
- `rtk harness status`: SUCCESS, exit 0 before documentation edits; state `migrated-v2`, web stack, no missing files, current task `20261015-222835066-kf53`.
- Read `package.json`, source entry points, WACRM plan, HARNESS files, and repository instructions.
- No tests, build, migration, or application behavior were run or changed.
- WACRM Git preflight: branch `main`, HEAD `e714fb0db5cd60cc797534a3e8d7c53e9986aac1`, `git diff --check` SUCCESS. Existing tracked and untracked state remains protected.

## Decisions and constraints
- PostgreSQL self-host is the approved database target; do not initialize or use Supabase local or remote.
- Existing WACRM code still uses Supabase Auth/SDK and direct Supabase access. PostgreSQL alone does not replace Auth, RLS, Storage, or Realtime.
- Do not switch branch, stage, commit, push, deploy, or discard existing work.
- No code migration belongs in the adoption task.

## Review result
An independent read-only Codex reviewer approved the architecture, command, and scope claims with no actionable findings. It confirmed the package scripts/dependencies and current Supabase use, and noted that the plan gates migration execution on approval. The reviewer did not run tests or migration commands.

## Exact next action
Create the existing plan's `migration/evolution-go-postgresql-selfhost` HARNESS task, starting with the baseline/inventory stages already defined by that plan. Preserve `main` and all preexisting changes.

## Tool usage
- HARNESS adoption files and CLI were used; RTK prefixed the status command.
- Serena was initialized and activated for WACRM; it mapped the browser/server Supabase client symbols and found a wide direct-consumer surface.
- Ruflo MCP is available, but its previous task execution in the parent Zap Lead session failed with `No LLM provider configured`; that prior result is not a review of these WACRM documentation edits.
- Caveman has no callable command in the current environment; its skill was read and concise checkpointing was applied manually.
