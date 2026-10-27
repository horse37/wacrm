# TDD RED — PostgreSQL invitation POST route

- Command: `npx vitest run src/app/api/account/invitations/route.test.ts --reporter=verbose`
- Result before route implementation: exit 1; 2 failed, 7 passed.
- Expected failure 1: POST still called `ctx.supabase.from(...).insert(...)`; the test expected a successful PostgreSQL repository create and received HTTP 500 after the mocked Supabase chain was absent.
- Expected failure 2: PostgreSQL SQLSTATE `42501` from the repository was not mapped by the old Supabase-only POST path, so the expected safe 403 was not returned.
- The failures identified the missing PostgreSQL route wiring and error mapping. No production route change preceded this run.
