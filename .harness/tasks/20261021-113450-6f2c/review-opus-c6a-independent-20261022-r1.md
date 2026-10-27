Scope: somente disposição da ressalva 6a do parecer Opus r2.

Verdict: REMEDIATION_REQUIRED

pg.Pool.onConnect is a one-time check for each new physical connection, separate from later business queries. The RLS and trusted-DBA boundary, and the unresolved H-DB-003/deployment status, are otherwise documented clearly.

The wording that administrative role changes require draining/restarting the pool could imply PostgreSQL changes take effect only after restart. Clarify that draining/restarting forces existing pooled connections through the guard again; it is not a prerequisite for database role or policy changes to take effect.

No files were modified and no tests or services were run by the reviewer. Approval was not granted.
