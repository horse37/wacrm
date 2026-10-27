# Read-only review request — PostgreSQL server-only client boundary

Review the frozen task slice only. Do not edit files, run tests, start Docker, or connect to any database.

## Files and intended changes

- scripts/testing/postgres-server-boundary.test.mjs — new static TypeScript-AST graph scanner and synthetic coverage.
- src/lib/db/postgres-pool.ts — newly adds import of Next.js server-only marker. This file had prior local modifications before this task.
- src/lib/db/postgres-pool.test.ts — newly mocks server-only for the existing isolated pool unit test. This file had prior local modifications before this task.
- .harness/tasks/20261020-130325-be1d/task.md, handoffs/implementer.md, validation logs, and this request — records for this slice.
- .harness/current-task.md — current pointer updated while prior task snapshots were preserved.

## Review questions

1. Does the scanner find all Next.js use client TS/TSX/JS/JSX entrypoints and traverse runtime relative/alias imports, re-exports, literal dynamic imports, `require()` calls, and TypeScript `import x = require(...)` references?
2. Does it correctly ignore type-only import/export/import-equals edges, resolve extension/index modules, and fail closed on non-literal runtime imports or unresolved local imports?
3. Does it reject direct pg imports and transitive access to PostgreSQL pool/client/repository modules without flagging the current client graphs?
4. Is import of server-only in postgres-pool.ts valid for Next.js and correctly isolated in Vitest?
5. Are task claims and validation evidence accurate and limited to this boundary slice?

Pre-existing pool and test-file changes are not part of this slice; do not attribute their behavior to this task. The first review found one P2: omitted `ImportEqualsDeclaration` traversal. The implementation now follows literal external module references, ignores `isTypeOnly`, and flags non-literal external references; a synthetic regression covers these paths. Follow-up review confirmed the code correction and found a P3 in the handoff; that record now labels the old 3/3 count pre-remediation and points to the final 4/4 result. Re-review the current files read-only. Approval applies only if findings = 0 and caveats = 0. Return exact APPROVE or list actionable findings with severity, file/line, and evidence. Do not imply approval of H-DB-003/H-DATA-003, Auth, grants, consumer wiring, production, or the overall PostgreSQL migration.
