# Implementer handoff — PostgreSQL account-member PATCH/DELETE routes

## Scope

Wire only `PATCH` and `DELETE /api/account/members/[userId]` to the already validated PostgreSQL role and removal repositories. Preserve admin guard, rate limits/order, role validation, owner-promotion rejection, and success payloads. Map database errors safely and preserve the repositories' privacy-preserving `not_found` category. Add focused route tests.

## Start state

- Task: `20261020-151247-5f0a`, `postgres-account-members-patch-delete-routes`, `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve the 299 existing status entries and all unrelated changes. Do not reset, restore, clean, switch branches, commit, push, or deploy.
- Role repository approval/evidence: `.harness/tasks/20261019-222944-b638/`.
- Removal repository approval/evidence: `.harness/tasks/20261019-224019-e819/`.
- Next Route Handler guide and dynamic `params` contract were read from `node_modules/next/dist/docs/` per root `AGENTS.md`.

## Validation plan

Write route tests before implementation; verify RED with `npm test -- --maxWorkers=1 --no-file-parallelism 'src/app/api/account/members/[userId]/route.test.ts'`. Then run the focused route test, `npx tsc --noEmit`, targeted ESLint with zero warnings, targeted Prettier check, and `git diff --check`. No new Docker resource is needed because route tests mock the unchanged repositories; their PostgreSQL 16 proofs are already recorded in the two dependency tasks.

## Implemented and checked

- Wired `PATCH` and `DELETE` to their existing repositories; no direct `.rpc` call remains in this route. Auth guard, rate-limit keys/order, body validation, and success payloads remain.
- TDD RED was 4 failed / 5 passed. Final focused route tests passed 11/11; TypeScript, targeted zero-warning ESLint, Prettier check, and global `git diff --check` passed.
- Repository error mapping returns safe statuses/messages and does not expose database error text. Existing Docker PostgreSQL 16 dependency proofs were reused; no database resource was created for handler tests.

## Next action

Independent GPT-6 Luna read-only review returned **APPROVE**, zero findings, and zero caveats for this route slice only; see `../review-gpt6-luna-final-20261020.md`. Keep this Harness task `in_progress`; next is a separate GET `/api/account/members` route-wiring task using the existing PostgreSQL repository. H-DB-003/H-DATA-003 remain in progress and unapproved overall.

## Boundaries

No Supabase persistence/network, Auth redesign, repository/RPC/migration/schema/grant edits, real credentials/data, application traffic, production, commit, push, or deploy. Keep H-DB-003/H-DATA-003 in progress and unapproved overall.
