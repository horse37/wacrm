Scope: Opus r2 caveat 4 — caller-settable webhook key-id GUC
Reviewer: GPT-6 Luna, independent, read-only
Verdict: APPROVE
Findings: 0
Caveats: 0

The documentation accurately states that the transaction-local key-id GUC is caller-settable by `wacrm_runtime`, narrows accidental unscoped queries as defense in depth, and is not an independent authentication or tenant-isolation boundary against a compromised runtime. The handler remains responsible for request authentication. No policy, grant, migration, or route behavior changed.

The existing disposable PostgreSQL evidence covers forced-RLS lookup, column scope, and same-connection GUC cleanup. Approval is limited to this caveat's documentation and disposition; it does not approve the full Opus review/task or H-DATA-003/H-DB-003.