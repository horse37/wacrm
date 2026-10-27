# Read-only review request — PostgreSQL flow-list route

Review only task `20261020-132606-e55d` and its scoped changes. Do not edit files, run tests, start Docker, or connect to any database or Supabase service.

Check:

1. `GET /api/flows` keeps the existing authenticated server-session gate and passes only the verified user ID to the PostgreSQL repository.
2. GET no longer queries Supabase data or admin clients; POST and other flows behavior remain untouched.
3. Response shape and status behavior match the task contract; repository failures do not leak driver details.
4. Account isolation, field projection, and ordering are provided by the existing tested PostgreSQL repository and are not weakened by route wiring.
5. Task records distinguish this GET-only slice from Auth/session replacement and the overall migration.

The existing Supabase Auth call is intentionally retained; no Supabase instance or service is contacted during this task. The PostgreSQL proof is disposable Docker-only synthetic evidence. Prettier normalized formatting across the route file; verify POST behavior has no semantic changes. Return exact `APPROVE` only with zero findings and zero caveats; otherwise list actionable findings with severity, file/line, and evidence. Do not imply H-SELF-002, H-DATA-003/H-DB-003 overall, POST migration, UI, production, or global migration approval.
