# Implementer handoff — PostgreSQL account-members GET route

## Start state

- Task: `20261020-152617-9d3a`, `postgres-account-members-get-route`, status `in_progress`.
- Repository: `C:\Sistemas\wacrm`; branch `main`; HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work. Do not reset, restore, clean, switch branches, commit, push, or deploy.
- User target: PostgreSQL in disposable Docker Desktop; no Supabase service, real credentials/data, or existing Docker resource use.

## Scope

Wire only `GET /api/account/members` to the existing account-members PostgreSQL repository. Keep the current verified-session/Auth context boundary unchanged. Preserve the public `{ members }` response and safe failures. Repository and its disposable PostgreSQL 16 two-account proof remain unchanged in `.harness/tasks/20261019-215941-005d/`.

## Implemented and checked

- Replaced only the GET route's direct Supabase member-row query with the existing PostgreSQL repository. Existing account/Auth context remains unchanged; repository receives only `ctx.userId`.
- Preserved `{ members }` and existing 401 behavior. PostgreSQL authorization failures map to 403; DB failures remain generic 500 responses.
- TDD RED: 4 failed / 1 passed; final focused route tests 5/5. Evidence: `validation-red.log`, `validation-focused-tests.log`.
- TypeScript, targeted ESLint with `--max-warnings=0`, targeted Prettier check, and `git diff --check` passed.
- Reused the unchanged repository's disposable PostgreSQL 16 Docker proof: `.harness/tasks/20261019-215941-005d/validation-postgres-account-members-5501c04534.log`. Route validation used mocks; no Supabase service or new Docker resource was contacted/created.

## Next action

Independent GPT-6 Luna read-only review returned **APPROVE**, zero findings, and zero caveats for this GET route slice; see `review-gpt6-luna-final-20261020.md` and `handoffs/reviewer.md`. Keep this Harness task `in_progress`; select the next narrow H-DATA-003 slice. H-DB-003/H-DATA-003 remain in progress and unapproved overall.

## Limits

No Auth/session-provider redesign, Supabase service access, repository/schema/grant changes, Storage, Realtime, real data, application traffic, production, commit, push, or deploy. Approval for this route slice will not approve H-DB-003/H-DATA-003 overall.
