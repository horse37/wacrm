# Implementer handoff — PostgreSQL flow delete route

## State
- Task `20261020-202740-c318`, H-DATA-003 phase 03, `in_progress`.
- Independent GPT-6 Luna read-only review returned `APPROVE`, 0 findings, 0 caveats for `DELETE /api/flows/[id]` only. Report: `review-gpt6-luna-final-20261020.md`.
- Branch `main`, HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing local changes. Do not reset, restore, clean, switch branches, commit, push, or deploy.

## Changes
- `src/app/api/flows/[id]/route.ts`: DELETE retains verified-session Auth and `{ ok: true }`, delegates to approved PostgreSQL delete repository, safely maps errors, and has no Supabase data/admin import/calls. GET and PUT unchanged in this slice.
- `src/app/api/flows/[id]/route.test.ts`: mocked-auth delegation, success, safe-error, and no-Supabase-data/admin coverage.

## Validation
- TDD RED: 5 failed / 12 passed before route wiring; `tdd-red-delete-route.log` records missing delegation/error mapping.
- Focused Vitest: 2 files, 24/24.
- TypeScript, targeted ESLint `--max-warnings=0`, Prettier check, and `git diff --check`: pass.
- Existing disposable PostgreSQL 16 forced-RLS proof reused; details in `validation-focused-20261020.log`.

## Limits / next action
No Supabase database/service access, real provider/data, app traffic, or production. H-DATA-003/H-DB-003 remain unapproved overall. Continue with next narrow route.