
REMEDIATION_REQUIRED

5 findings (1 P1, 2 P2, 2 P3) e 9 ressalvas. Não li todo o working tree, e isso sozinho já impede um APPROVE.

Identidade e escopo

- Repositório: C:\Sistemas\wacrm, branch main, HEAD 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c, tudo conforme o esperado.
- Inventário: 1.516 entradas no git status. São 45 arquivos rastreados alterados (+3.367/−2.825) e cerca de 1.470 não rastreados: 1.093 em .harness/tasks/, 8 do painel, cerca de 180 em scripts/testing, 30 testes de rota, 1 rota nova, cerca de 150 em src/lib e a migration 028.
- Lido por inteiro:
  - Painel: .harness/dashboard-review-progress.mjs (linhas 150–330), dashboard-validation-result.mjs, dashboard-http.mjs e dashboard-server.mjs (imports e linhas 100–215, 390–465).
  - Banco: src/lib/db/postgres-pool.ts, postgres-client.ts, errors.ts, src/lib/auth/postgres-account-guard.ts e supabase/migrations/028_*.sql.
  - Rotas: redeem/route.ts, flows/route.ts (linhas 1–80) e os trechos de whatsapp/send/route.ts (atual e base).
  - Repositórios: invitation-redemption.ts, zap-lead-webhook-credential-read.ts, whatsapp-send-flow-run.ts, account-member-removal.ts, accounts.ts e flow-create-persistence.ts (linhas 235–300).
  - Diffs de webhook/route.ts, credentials.ts e package.json.
- Lido em parte:
  - Varredura de todos os src/lib/repositories/*.ts buscando server-only, account_id e interpolação em SQL.
  - Mapa das escritas nos repositórios contra as policies de escrita nas migrations.
  - Grants das RPCs nas migrations 018 e 019, o migrate-postgres.mjs (papel dono) e o pg-pool instalado (onConnect, a partir da linha 289).
  - Parecer-base completo, current-task.md e trechos do HANDOFF-CONTEXT.md, do task.md e das linhas Scope/Verdict das revisões de 2026-10-22.

Findings (defeitos de código)

1. P1 — Rotas migradas para PostgreSQL sem flag e sem grants versionados
- Onde: 25 arquivos em src/app/api/**/route.ts importam @/lib/repositories/*. Por exemplo, src/app/api/flows/route.ts:42 cria o repositório PostgreSQL direto. O pool fica em src/lib/db/postgres-pool.ts:109-125.
- Cenário:
  - Sem DATABASE_URL, o pool lança erro, que vira db_error e as rotas respondem 500.
  - Com o papel wacrm_runtime que a 028 pressupõe, os únicos grants versionados são das tabelas zap_lead_* e is_account_member. O guard consulta public.profiles (postgres-account-guard.ts:55-66) e recebe permission denied. Resultado: 500 em accounts, flows, automations, whatsapp e invitations.
  - As RPCs das migrations 018 e 019 só têm GRANT EXECUTE para authenticated (018:112, 205, 283 e 019:237).
- Impacto: se este tree for implantado, quase toda a API cai. Só o webhook tem trava. A base usava Supabase e funcionava.
- Causa: a troca de caminho é incondicional, e a matriz de privilégios ficou para a H-DB-003, que ainda não foi aprovada.
- Correção mínima: pôr uma flag fail-closed por rota (como no webhook) ou manter o caminho Supabase até a H-DB-003 versionar os grants e as policies. No mínimo, registrar na task que o tree não pode ser implantado.

2. P2 — Pausa do flow quando o atendente responde vira operação vazia e silenciosa
- Onde: src/lib/repositories/whatsapp-send-flow-run.ts:57-68, chamado em src/app/api/whatsapp/send/route.ts:394.
- Cenário:
  - Para flow_runs, as migrations só têm policy de SELECT (017:429).
  - A base fazia o UPDATE com supabaseAdmin(), que ignora RLS.
  - Agora o UPDATE roda sob RLS, atinge 0 linhas e retorna false, sem erro e sem log.
- Impacto: o robô continua falando depois que o atendente assume a conversa.
- Correção mínima: versionar uma policy de UPDATE de flow_runs (H-DB-003) ou manter o caminho admin para essa escrita. Testar contra o schema das migrations, não contra a fixture com a policy temporária.

3. P2 — Resgate de convite trata qualquer SQLSTATE 42501 como "não autenticado"
- Onde: src/lib/repositories/invitation-redemption.ts:57-58 e src/lib/db/errors.ts:73-80.
- Cenário: o 42501 cobre tanto o RAISE da RPC (019:140, 168) quanto permission denied for function redeem_invitation. Esse segundo caso acontece com o papel do runtime, porque o grant só existe para authenticated. Um usuário logado recebe 401 "Unauthorized", e nada é registrado em log, já que só db_error é logado.
- Impacto: erro de configuração fica disfarçado de falha de autenticação.
- Correção mínima: só mapear para unauthorized quando o erro vier do RAISE (no pg, error.routine === 'exec_stmt_raise'; no caso de ACL é aclcheck_error) e tratar o resto como db_error com log. Adicionar teste para os dois casos.

4. P3 — Parser de validação não reconhece falha do node:test
- Onde: .harness/dashboard-validation-result.mjs:6-19.
- Cenário: as resumos ℹ fail 1, # fail 1 e not ok 1 - ... não são detectados. Esse é o formato usado nos próprios logs desta task (já aparecem ℹ fail 0 e # fail 0). Um log com teste falhando sem AssertionError (por exemplo, timeout ou Error lançado) seguido de Exit code: 0 de outro comando é classificado como PASS.
- Correção mínima: acrescentar /^\s*(?:ℹ|#)\s*fail\s+[1-9]\d*/m e /^not ok\b/m à lista de falhas, com teste.

5. P3 — Dois erros de precisão no parser de reviews
- Onde: .harness/dashboard-review-progress.mjs:230-232 e :167.
- Hora truncada: em (\d{4}|\d{6}), a alternativa de 4 dígitos é tentada primeiro, então HHMMSS vira HHMM. Reviews do mesmo minuto empatam. O erro é na direção segura (o empate fica em REMEDIATION_REQUIRED), mas pode prender uma aprovação legítima.
- \bárvore nunca casa: o \b só reconhece ASCII, e "á" não conta como letra. Um Escopo: árvore de trabalho, A1–A5 cai nos grupos A1 e A5, e uma aprovação posterior de fatia derruba a reprovação integral. É o cenário do achado 1 original, só que em português.
- Correção mínima: usar (\d{6}|\d{4}) e trocar o \b por (?:^|[^\p{L}]) com flag u, com teste.

Reavaliação dos achados anteriores

┌───────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────┐
│      Achado       │                                        Estado atual                                         │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Ordem e        │ Corrigido. A ordem agora é data, hora, rodada e fase. Escopo integral vai para o grupo      │
│ agregação         │ task, que só uma aprovação integral libera. Há testes nas linhas 30, 55, 80 e 114. Resíduo  │
│                   │ no finding 5.                                                                               │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│                   │ Corrigido. O pg-pool instalado executa onConnect e fecha a conexão se ele falhar. Erro de   │
│ 2. Papel do       │ consulta, linha ausente, superuser, BYPASSRLS, CREATEDB/CREATEROLE e membership             │
│ runtime           │ privilegiada são negados, tanto para current_user quanto para session_user. Ressalvas 4 e   │
│                   │ 5.                                                                                          │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. Migration,     │ Parcial. A 028 é versionada, com preflight, FORCE RLS e grants por coluna nas tabelas       │
│ policy e grants   │ zap_lead_*. Mas ela não cria o papel e não cobre as demais tabelas nem as RPCs (findings 1  │
│                   │ a 3).                                                                                       │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. Flag do        │ Corrigido. Só WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED === '1' libera a    │
│ webhook           │ rota (route.ts:176), e o nome antigo não libera nada. O comentário diz certo que os recibos │
│                   │  continuam pela RPC Supabase.                                                               │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 5. Contrato do    │ As mensagens estáveis e o mapeamento por código estão corretos: 400 para inválido, usado,   │
│ convite           │ expirado ou inexistente; 409 para conflito; nenhuma mensagem do PostgreSQL vaza. Defeito    │
│                   │ novo no finding 3.                                                                          │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 6. Parser de      │ Corrigido para AssertionError e Exit status, que têm precedência sobre sucesso. Resíduo no  │
│ validação         │ finding 4.                                                                                  │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Import do         │                                                                                             │
│ classifyReview no │ Corrigido (dashboard-server.mjs:13). Ressalva 6.                                            │
│  painel           │                                                                                             │
└───────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────┘

Também conferi sem achados:
- Bind em 127.0.0.1 com Host loopback.
- Bootstrap com < escapado e replace por função.
- server-only em todos os repositórios.
- SQL parametrizado (a única interpolação, em flow-create-persistence.ts:278, usa colunas constantes).
- set_config local à transação, com ROLLBACK e release(err).

Ressalvas (cobertura e processo)

1. Cobertura parcial:
   - Não li cerca de 62 dos 70 repositórios e seus testes, 21 das 25 rotas, os 30 testes de rota, cerca de 90 scripts de integração .mjs, cerca de 90 .ps1, os page.tsx alterados, src/types/index.ts, src/lib/flows/validate.ts, scripts/migrate-postgres.test.mjs, validate-pool-and-runner.ps1 e as fixtures SQL.
   - Também não li o task.md inteiro, os handoffs, o corpo das revisões limitadas nem os logs de evidência (só fiz buscas neles). A maioria dos 1.093 arquivos Harness também ficou de fora.
2. Nada foi executado. Os findings 1 a 3 vêm da leitura de código e migrations, sem reprodução.
3. Policies da 028 fixas em TO postgres. Isso é coerente, porque 017 a 019 já fazem OWNER TO postgres, mas amarra a migration ao dono postgres, enquanto WACRM_MIGRATION_OWNER_ROLE aceita outro nome.
4. A policy por key_id só exige conhecer o key_id. Qualquer sessão do runtime pode definir o GUC, então ela é só uma camada extra de defesa, não uma barreira de verdade.
5. O guard do pool só verifica a posse das duas tabelas zap_lead_*. Se o papel do runtime for dono de outra tabela sem FORCE RLS, ele ignora a RLS dela.
6. A checagem de papel roda numa transação separada da escrita. Fica uma janela entre a checagem e a escrita, coberta só pela RLS. Além disso, o catch { return [] } em dashboard-server.mjs:181 continua escondendo falhas futuras.
7. Com a flag desligada, todo webhook recebe 503. É fail-closed proposital, mas muda o comportamento em relação à base.
8. HANDOFF-CONTEXT.md:105 está em parte desatualizado. Ele diz que as migrations não criam grants nem policy, mas a 028 agora cria os dois; o papel em si continua sem ser criado.
9. Repositórios de automação sem uso em produção. automation-pending-* e automation-log-* só aparecem nos testes. Além disso, automation_pending_executions não tem policy de escrita.

Nada aqui aprova a task, a H-DATA-003 ou a H-DB-003. Supabase, produção e dados reais não foram acessados.

---
Pulei a leitura integral da maior parte do tree (ressalva 1) e não executei nada. O risco principal é o finding 1: este tree não pode ser implantado como está.