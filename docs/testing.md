# Testing — WACRM

## Available commands

- Focused unit/component tests: `npx vitest run <path...>`.
- Full Vitest suite: `npm test` (`vitest run`).
- TypeScript: `npm run typecheck`.
- Lint: `npm run lint`.
- Formatting check: `npm run format:check`.
- Zap Lead heartbeat scheduler: `npm run test:zap-lead:heartbeat-scheduler`.

Use the narrowest relevant test set first, then the broader checks required by the active task. Record exact commands, exit codes, failures, and warnings. Do not treat mock-based tests as evidence of real authentication, database persistence, or provider behavior.

## Current database limitation

At the inspected HEAD, the app uses `@supabase/ssr` and `@supabase/supabase-js`; `package.json` has no PostgreSQL driver and this repository has no configured PostgreSQL integration-test command. Existing tests around Zap Lead use mocks. Do not start or use Supabase local or remote. PostgreSQL/Docker is the project target; add a disposable PostgreSQL test path as part of the approved migration work before claiming database-backed WACRM behavior.

## Next.js changes

Before changing Next.js code, read the relevant version-specific guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.

## Docker policy

Runtime and integration validation must use Docker Desktop with synthetic data and disposable containers/volumes. Preserve existing containers and volumes unless a task explicitly names a disposable resource it owns. Never use production credentials or real WhatsApp chips for local validation.
