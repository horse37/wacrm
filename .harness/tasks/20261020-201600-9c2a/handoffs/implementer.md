# Implementer handoff — PostgreSQL flow update route

## State
- Task `20261020-201600-9c2a`, H-DATA-003 phase 03, `in_progress`.
- Independent GPT-6 Luna read-only review returned `APPROVE`, 0 findings, 0 caveats for `PUT /api/flows/[id]` only. Report: `review-gpt6-luna-final-20261020.md`.
- Branch `main`, HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing local changes. Do not reset, restore, clean, switch branches, commit, push, or deploy.

## Changes
- `src/app/api/flows/[id]/route.ts`: PUT uses approved PostgreSQL repositories for header update, optional atomic graph replacement, and final editor DTO load. Existing GET and DELETE data paths were not changed. Verified-session Auth remains.
- `src/app/api/flows/[id]/route.test.ts`: mocked-auth delegation, validation, safe error, and no-Supabase-data/admin tests.

## Validation
- TDD RED: 3 failed / 5 passed before route wiring; `tdd-red-put-route.log` records missing delegation and legacy lookup.
- Focused Vitest: 5 files, 52/52.
- TypeScript, targeted ESLint `--max-warnings=0`, Prettier check, and `git diff --check`: pass.
- Existing disposable PostgreSQL 16 forced-RLS repository evidence reused; details in `validation-focused-20261020.log`.

## Limits / next action
No Supabase database/service access, real provider/data, app traffic, or production. H-DATA-003/H-DB-003 remain unapproved overall. Continue with the next narrow flow route.