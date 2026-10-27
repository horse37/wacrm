# GPT-6 Luna independent review — Opus finding 3 — round 1

**Scope:** the runtime role preflight and migration-parity evidence for Opus finding 3 only.

**Verdict: REMEDIATION_REQUIRED**

- **P2 — A migration não valida que `wacrm_runtime` seja realmente não privilegiado.** Em `supabase/migrations/028_zap_lead_runtime_read_policies.sql:3`, o preflight verifica apenas se o papel existe. Como sua criação fica a cargo do deployment, a migration também pode ser aplicada se esse papel for `SUPERUSER`, tiver `BYPASSRLS` ou herdar/mudar para um papel com privilégios mais amplos. No primeiro caso, `FORCE ROW LEVEL SECURITY` não garante isolamento; no segundo, os `REVOKE` diretos não removem privilégios obtidos por associação. A integração comprova a política com o papel restrito criado pelo bootstrap descartável, mas não comprova que a migration rejeite uma configuração insegura. **Correção acionável:** falhar no preflight se o papel tiver atributos privilegiados ou associação a papéis incompatíveis com o runtime; incluir essa validação na prova de instalação.

O restante da prova examinada aplica a cadeia 001–028 e exercita os três leitores em PostgreSQL descartável. O fixture histórico está explicitamente marcado como não sendo prova de paridade, e o validador descreve uso de banco em `tmpfs`, rede isolada, montagem somente leitura e limpeza; o log registra sucesso e ausência de containers residuais.

Esta conclusão cobre somente o achado 3. Não aprova a task inteira, os achados 4–6, H-DATA-003 ou H-DB-003.
