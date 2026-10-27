Scope: Opus r2 caveat 5 — runtime ownership of user tables
Reviewer: GPT-6 Luna, independent, read-only
Verdict: APPROVE
Findings: 0
Caveats: 0

The pool guard checks pg_class relkind ('r','p'), joins owner OIDs, excludes information_schema and names prefixed pg_ (system/temp schemas), and includes those owners in the privileged membership checks for both effective and session roles. This rejects runtime ownership of any regular/partitioned user table, including an RLS-enabled table without FORCE, even after CREATE privilege is revoked.

The disposable integration creates the probe under SET ROLE wacrm_runtime, enables RLS without FORCE, resets the role and revokes CREATE, then confirms pool rejection before SELECT. The ordinary runtime probe still passes. The red log proves the old guard missed the case; final log records all steps and cleanup. Pool unit tests 23/23; TypeScript, ESLint, Prettier, PowerShell parse and diff checks pass.

Approval limited to caveat 5; no task/global approval.