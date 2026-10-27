# Task — PostgreSQL server-only client boundary

- id: 20261020-130325-be1d
- type: migration
- slug: postgres-server-only-client-boundary
- roadmap: H-DB-003

## Goal

Keep PostgreSQL driver and pool modules out of Next.js client-component import graphs.

## Context

The pool/runner slice established server-side PostgreSQL usage but did not add an automated import guard. H-DB-003's reviewed design requires the database client boundary to stay server-only. H-SELF-002, production roles/grants, and consumer wiring remain separate and unapproved.

## In scope

- Add the Next.js server-only marker to src/lib/db/postgres-pool.ts.
- Add a focused TypeScript-AST import-graph test that discovers use client TS/TSX/JS/JSX entries, follows runtime relative and @/ imports (including static and dynamic imports), ignores type-only edges, and rejects paths to pg, PostgreSQL pool/client modules, or repositories.
- Include synthetic tests for transitive imports, dynamic imports, alias resolution, and type-only imports/exports.
- Keep changes limited to the boundary guard, the pool's existing unit-test mock, and this task's records.

## Out of scope

No UI/API wiring, Auth/session replacement, database access or Docker containers, schema/migrations, grants/RLS/roles, Supabase, Storage, Realtime, real credentials/data, application traffic, production, branch/history changes, commit, push, or deploy. H-DB-003 and H-DATA-003 remain unapproved overall.

## Validation

- TDD RED and focused Node test: node --test scripts/testing/postgres-server-boundary.test.mjs.
- Pool unit tests: npx vitest run src/lib/db/postgres-pool.test.ts --maxWorkers=1 --no-file-parallelism.
- TypeScript: npx tsc --noEmit.
- Targeted ESLint with --max-warnings=0; targeted Prettier check; git diff --check.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact APPROVE, zero findings, zero caveats.

## Validation results

See validation-tdd-red.log, validation-final.log (pre-remediation baseline, superseded for scanner count), and validation-review-remediation.log (final scanner 4/4). Pool Vitest 13/13, TypeScript, targeted ESLint with zero warnings, Prettier, and git diff --check passed after code remediation.

## Independent review

Independent GPT-6 Luna review first found a P2: scanner omitted TypeScript `ImportEqualsDeclaration` runtime references. The scanner now follows literal `import x = require(...)`, ignores `import type x = require(...)`, and reports non-literal external module references as violations; regression tests cover transitive alias traversal, type-only exclusion, and fail-closed behavior. Follow-up reviews found stale validation wording and record fragments; records now distinguish the pre-remediation 3/3 baseline from the final 4/4 result. Final same-model read-only re-review returned exact APPROVE, zero findings, zero caveats. Approval covers this boundary slice only; pool files contained prior local changes. H-DB-003/H-DATA-003 remain unapproved overall.

## Next action

Boundary slice received exact APPROVE with zero findings and zero caveats. Keep this HARNESS task in_progress; next inspect remaining H-DATA-003 work and define the next narrow PostgreSQL-only task. Keep H-DB-003/H-DATA-003 unapproved overall.
