Verdict: REMEDIATION_REQUIRED

Findings

1. P2 — O parser pode deixar uma aprovação antiga de fatia vencer uma reprovação mais nova.
   - Onde: .harness/dashboard-review-progress.mjs:210-240 (reviewOrder), usado em :247 (resolveReviewScopes).
   - Cenário: a ordem é [fase, tem-rodada, rodada, data, hora], e a fase vem de palavras no nome do arquivo (independent e final valem 3, remediation vale 2, outros valem 1). A data é o último critério. Exemplos:
     - review-a2-independent-20261022-r6 (APPROVE, fase 3) vence um futuro review-a2-remediation-20261023 ou review-a2-20261023 com REMEDIATION_REQUIRED.
     - Um re-review …-20261023-r1 perde para o r6 mais antigo.
     - O próximo arquivo esperado é esta revisão, salva como review-opus-working-tree-…. Se a linha Scope: citar "A1–A5", o parser extrai A1 e A5 (:164-208), então a reprovação cai em grupos onde os arquivos independent do Luna têm fase 3 e vencem. O agregado ficaria APPROVE com o parecer integral reprovado.
   - Impacto: falso APPROVE no painel e nos contadores latestSliceApproved e completedTasksApproved.
   - Evidência: leitura do código. A regra de supersessão por fase e rodada antes da data não tem teste (grep por "newer", "later date" e "chronolog" só achou o teste da linha 30, sobre outro caso).
   - Correção mínima: ordenar por data e hora do nome (ou do registro) primeiro e usar rodada só como desempate. Reprovação de escopo "working tree" ou "task" nunca pode ser superada por aprovação de fatia. Adicionar testes para os dois casos.
2. P2 — Nenhuma proteção contra pool conectado com papel que ignora RLS.
   - Onde: src/lib/db/postgres-pool.ts:25-48 e src/lib/repositories/invitation-redemption.ts, zap-lead-event-stream-read.ts, zap-lead-webhook-credential-read.ts.
   - Cenário:
     - A identidade é só set_config('request.jwt.claim.sub', $1, true).
     - O pool aceita qualquer DATABASE_URL, sem checar rolsuper/rolbypassrls nem usar SET LOCAL ROLE.
     - Se a URL apontar para o postgres do Supabase ou para qualquer papel BYPASSRLS, as consultas seguem com os filtros account_id = $1 do próprio app e nenhuma policy como segunda barreira.
     - scripts/migrate-postgres.mjs valida papéis (:86-130), mas o runtime não.
   - Impacto: o isolamento entre contas depende de configuração externa que o código nunca confere.
   - Correção mínima: na primeira conexão, consultar pg_roles do current_user e falhar fechado se for superuser, BYPASSRLS ou membro de papel privilegiado. Cobrir com teste.
3. P2 — Policy RLS e grants do runtime existem só como fixture, não como migration instalável.
   - Onde: .harness/tasks/20261021-113450-6f2c/postgres-zap-lead-webhook-credential-read-fixture.sql (cabeçalho), contra supabase/migrations/024_zap_lead_integrations.sql:10-41.
   - Cenário:
     - A migration 024 define policies e grants para authenticated. Nada em supabase/ define o GUC app.wacrm_zap_lead_webhook_key_id, que zap-lead-webhook-credential-read.ts:28 usa.
     - Não há grant para o papel de runtime nem FORCE ROW LEVEL SECURITY.
     - O próprio fixture admite que is_account_member é SECURITY INVOKER ali e SECURITY DEFINER na 017, e que "passing this fixture does not establish migration parity".
   - Impacto: os testes passam contra um esquema que o produto não instala. Em um banco com as migrations atuais, o lookup do webhook falha ou, com papel permissivo, não tem a policy que se supõe.
   - Observação: o H-DB-003 não está aprovado, então isto é coerente com o estado declarado. Continua sendo achado aberto, não aprovação.
4. P2 — O flag "POSTGRES_ENABLED" liga um caminho que ainda é parcialmente Supabase.
   - Onde: src/app/api/zap-lead/webhook/route.ts:12,173, src/lib/zap-lead/events.ts:26 e src/lib/zap-lead/credentials.ts:204.
   - Cenário: com WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED=1, a credencial vem do PostgreSQL, mas acceptZapLeadWebhookEvent ainda usa zapLeadAdminClient().rpc(...) (Supabase service role), assim como o alvo de saúde em credentials.ts:204.
   - Impacto: o nome sugere caminho PostgreSQL completo. Ligar o flag mistura leitura no PG com escrita no Supabase, fora do que a task declara aprovado.
   - Correção mínima: renomear o flag ou documentar o caminho misto na rota. A trava em si está correta (ver reavaliação de A5 abaixo).
5. P3 — Regressão de contrato no resgate de convite.
   - Onde: src/app/api/invitations/[token]/redeem/route.ts:32-53, src/lib/db/errors.ts (mensagens fixas) e src/app/join/[token]/page.tsx:~180-190.
   - Cenário: antes, a rota devolvia a mensagem da RPC (usado/expirado/inexistente em 400; "já está em outra conta" em 409). Agora devolve texto genérico ("The request is invalid.", "The operation conflicts with existing data."). A página exibe payload.error direto no modal de conflito.
   - Impacto: perda de informação para o usuário. not_found virou 404 (antes 400) e forbidden virou 401.
   - Correção mínima: mapear códigos para mensagens estáveis na rota e testar o contrato de status.
6. P3 — O parser de resultado de validação aceita PASS com uma única linha de sucesso.
   - Onde: .harness/dashboard-validation-result.mjs:5-30.
   - Cenário: logs com vários comandos podem ter Exit code: 0 de um deles e falha em formato não coberto, como AssertionError sem FAIL, ou "Exit status 1".
   - Impacto: possível PASS indevido. Baixa probabilidade, não verificada por execução.

Reavaliação de A1–A5 e das ressalvas anteriores

- A1 (crases): corrigido no código. Em campos de verdict e contagem as crases são removidas e o conteúdo mantido (:~79-83). Verdict: \APPROVE`e**Veredito: `APPROVE`…**` são reconhecidos. Cercas, blocos indentados e seções "Example" continuam ignorados, na direção segura. Não vi o corpo dos testes, só o título "parses verdict and count values wrapped in inline code in review fields". Não confirmo cobertura de amostras reais.
- A2 (painel/rótulo): o rótulo e o Host loopback (dashboard-http.mjs, bind em 127.0.0.1, :440) estão corretos no código. Não verifiquei o processo vivo, o PID 19400 nem os headers HTTP. Aceito só o que está no registro review-a2-independent-20261022-r6.md.
- A3 (Scope): a extração só de P\d-\d e A[1-5], com corte nas negações, resolve os casos H-DATA e H-DB. Continua dependente do achado 1 acima. "A1–A5" vira só A1 e A5.
- A4 (registros de task): não avaliado, não li task.md, o handoff nem o HANDOFF-CONTEXT.md.
- A5 (trava do webhook): correta para o escopo declarado. route.ts:173 exige === '1' antes de ler headers, corpo, credencial ou persistir. O teste cobre variável ausente, vazia e 'true' com spy em body.getReader, e os mocks de credencial e persistência não são chamados. Concordo com review-webhook-fail-closed-independent-20261021-r2.md nesse escopo. A ressalva do achado 4 é sobre o nome e o caminho misto, não sobre a trava.
- Rótulo A5 ambíguo: este prompt chama de A5 a trava do webhook. Os arquivos review-a5-independent-* da task tratam A5 como proveniência dos registros. O painel agrupa por esse rótulo, então convém desambiguar nos registros.
- Pool/server-only: import 'server-only' em postgres-pool.ts e nos repositórios lidos barra uso no cliente em Next. Não verifiquei como os scripts de integração em Node puro contornam isso, nem se server-only está nas outras ~148 camadas.
- Parametrização, transação e rollback: nos arquivos lidos (postgres-client.ts, repositórios de convite, event stream e credencial), as queries são parametrizadas, set_config(..., true) fica restrito à transação, há ROLLBACK e release(err) em caso de falha, e as consultas com LIMIT 2 rejeitam duplicidade. Não vi achado nessas partes.
- Isolamento entre contas nas demais rotas, grants/RLS por tabela, fixtures contra migrations e cleanup dos scripts de integração: não avaliados, por limite de cobertura.

Caveats

- A cobertura acima é parcial. A maior parte dos 44 arquivos rastreados e dos 1.431 não rastreados não foi lida, então não há base para aprovar o working tree.
- Os achados 1, 5 e 6 vêm de leitura de código, sem execução; o 1 não foi reproduzido. Os achados 2, 3 e 4 vêm de leitura de código e fixture.
- Nada nesta revisão aprova a task Harness, H-DATA-003 ou H-DB-003 globalmente. Supabase, Auth, Storage, Realtime, tráfego de aplicação e produção continuam fora do escopo e sem aprovação.
- As aprovações Luna seguem válidas só para suas fatias. O achado 1 mostra que o painel pode apresentá-las como estado agregado de forma enganosa.
