# Revisão independente GPT-6 Luna — achado 3 — rodada 2

**Veredito: REMEDIATION_REQUIRED**

## Achados

1. **P2 — O preflight pode aceitar `wacrm_runtime` como membro do papel proprietário `postgres`.**

   Em `supabase/migrations/028_zap_lead_runtime_read_policies.sql`, a lista de memberships incompatíveis não inclui `postgres`. O bootstrap da prova cria `postgres` como `NOLOGIN NOINHERIT`, e a migration cria políticas administrativas `FOR ALL TO postgres`. Se `wacrm_runtime` for membro de `postgres`, o teste `pg_has_role(..., 'MEMBER')` encontra a associação, mas o filtro não classifica esse papel como privilegiado. `NOINHERIT` não impede `SET ROLE`; o runtime poderia assumir a identidade do proprietário e acessar a política administrativa irrestrita.

   **Correção acionável:** rejeitar associação a `postgres` e a qualquer papel proprietário das tabelas protegidas; adicionar uma prova negativa de membership que confirme que a migration falha nesse caso.

## Evidências verificadas

- O script de preflight executa o SQL da migration e verifica a rejeição de cinco configurações: `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE` e associação a papel `BYPASSRLS`.
- Os logs registram a aplicação das migrations 001–028 em PostgreSQL 16 descartável e a integração dos leitores concluída com sucesso.
- O validador registra rede isolada, banco em `tmpfs`, montagem do repositório somente leitura e ausência de containers residuais.
- Não encontrei prova negativa para papel runtime ausente nem para associação ao papel proprietário `postgres`.

A evidência sustenta a instalação e os leitores no PostgreSQL descartável, mas não cobre a associação incompatível identificada acima. Esta revisão limita-se ao delta do achado 3; não aprova os achados 4–6, a task inteira, H-DATA-003 ou H-DB-003.
