# Revisão independente GPT-6 Luna — P2-1, rodada 1

## Index metadata (derived by implementer; not reviewer-authored)
Record type: review summary; not verbatim.
Scope: P2-1 only — disposable fixture grants and account-based RLS coverage.
Verdict: REMEDIATION_REQUIRED
Findings: 1
Caveats: 0
Original output: Codex reviewer thread 01a15ef2-4d84-7e61-9ea5-6cced06af424.
Provenance catalog: review-provenance-index.md.


**Veredito: REMEDIATION_REQUIRED.**

> The fixture grants exactly the columns used by the readers: the webhook lookup needs `key_id`, `account_id`, and `encrypted_registration`; registration also needs `api_base_url`; event-stream integration needs `account_id`, `api_base_url`, and `encrypted_registration`. The grants are column-scoped, deny `created_at`, and exist only in the disposable fixture. The validation log reports success.
>
> One gap remains: the fixture’s only SELECT policy filters rows by `app.wacrm_zap_lead_webhook_key_id` ([fixture](C:/Sistemas/wacrm/.harness/tasks/20261021-113450-6f2c/postgres-zap-lead-webhook-credential-read-fixture.sql:48)). The `api_base_url` probe sets that webhook key and runs a hand-written query ([integration script](C:/Sistemas/wacrm/scripts/testing/postgres-zap-lead-webhook-credential-read-integration.mjs:121)). It does not exercise the registration or event-stream readers, which set `request.jwt.claim.sub` and query by account ID ([registration reader](C:/Sistemas/wacrm/src/lib/repositories/zap-lead-registration-read.ts:78), [event-stream reader](C:/Sistemas/wacrm/src/lib/repositories/zap-lead-event-stream-read.ts:54)). Thus, column privilege coverage is demonstrated, but those callers’ row visibility under their account-based RLS context is not.
>
> Minimal fix: extend the disposable fixture with the account-scoped RLS setup needed for those reads, then invoke both existing readers with synthetic account identities and assert their expected results. Keep all grants and policies fixture-only.

Revisor: GPT-6 Luna independente, somente leitura. P2-1 ainda não aprovado; não avançar para P2-3.
