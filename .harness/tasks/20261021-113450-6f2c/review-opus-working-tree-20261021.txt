Parecer: revisão independente, somente leitura

Veredito: REMEDIATION_REQUIRED

A revisão cobre só o working tree de C:\Sistemas\wacrm desde o HEAD 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c. Ela não aprova a task inteira, H-DATA-003, H-DB-003, Supabase, Auth, Storage, Realtime, tráfego de aplicação nem produção.

Estado confirmado com Git: branch main, HEAD igual à base e 1.428 entradas (42 modificadas e 1.386 não rastreadas, contadas com --untracked-files=all). O tracked diff tem 42 arquivos, +5.464/−2.786.

O que fiz: não editei arquivos e não rodei testes, builds, migrations nem Docker. As conclusões sobre o parser vêm de leitura do código, sem executá-lo. Além disso, só li status.json e server.json do painel em %LOCALAPPDATA%\Wacrm\migration-dashboard e consultei o PID do painel com Get-Process.

Limite de profundidade: li a fundo os registros da task 20261021-113450-6f2c, o código e os testes do painel, e os diffs pequenos (credentials.ts, postgres-pool.ts, package.json, validate.ts, project-map.md), além do repositório do webhook. Não revisei linha a linha os ~148 arquivos de src/lib/repositories, os ~180 scripts de integração e validação, nem os diffs grandes das rotas. A revisão não declara essas partes livres de achados.

---

Achados

A1 — P2 — Verdicts entre crases somem do parser (regressão das rodadas 6 a 9 do P3-1)

- Onde: .harness/dashboard-review-progress.mjs:73, chamado por classifyReview (:123–124).
- Cenário: reviewTextWithoutExamples troca todo trecho entre crases por espaço antes de procurar o verdict. A linha - Verdict: \APPROVE`.vira- Verdict:  ., então explicitVerdictretorna''e a classificação ficapendente. A linha Result: `REMEDIATION_REQUIRED`também virapendente`.
- Impacto:
  - 58 registros de review em 41 diretórios de task usam esse formato.
  - Nesta task, isso inclui review-p3-1-independent-20261021-r9.md, review-p2-3-independent-20261021-r2-clarification.md, review-p3-2-independent-20261021-r2.md, review-luna-hdb003-blocker-r2.md e review-luna-fixture-contract.md.
  - Com o código atual, o painel deixaria de contar essas aprovações e também perderia rodadas REMEDIATION_REQUIRED históricas.
  - Os 24 testes não pegam o problema porque nenhum usa verdict entre crases, que é o formato real dos registros.
- Correção: não remover o valor entre crases quando ele é o valor de um campo de verdict ou de contagem; basta retirar as crases nesses campos. Também vale incluir testes com os formatos reais (Verdict: \APPROVE`, **Veredito: `APPROVE`. Zero achados. Zero ressalvas.**`) e, de preferência, um teste que classifique uma amostra dos arquivos reais.

A2 — P2 — O painel no ar roda código antigo, e o registro afirma um resultado que o código atual não produz

- Onde: task.md:129 ("Latest local dashboard API reports … current finding review APPROVE") e dashboard-server.mjs:7–16, que importa os módulos de forma estática.
- Cenário:
  - O processo do painel (PID 9980) começou às 14:43:12; server.json tem o mesmo horário.
  - dashboard-review-progress.mjs mudou depois, às 17:11 (rodadas 6 a 9), e o processo não foi reiniciado.
  - O status.json atual (checkedAt 20:33Z, dirtyEntries 1428) mostra currentReview: APPROVE e latestSliceApproved: 30. Esses números vêm do código antigo.
  - Pelo A1, o código em disco classificaria a r9 e a clarificação do P2-3 como pendente.
  - Mesmo sem o A1, a clarificação do P2-3 não traz contagem explícita de findings e caveats. Pela regra das rodadas 3 a 5, ela não daria APPROVE.
- Impacto: a prova da P3-2 (painel reiniciado e atualizado) ficou velha de novo, e o registro descreve um resultado que o código revisado não gera.
- Correção: depois de corrigir o A1, reiniciar o painel e registrar PID e horário de início posteriores à última alteração dos módulos. Em seguida, recapturar /api/status e corrigir task.md:129 e o handoff com o resultado de fato observado.

A3 — P3 — Ressalvas no Scope: viram escopos e separam a rodada inicial da final

- Onde: dashboard-review-progress.mjs:150–160 (reviewScopes).
- Cenário: frases como "does not approve H-DATA-003 or H-DB-003" na linha Scope: fazem a review ser agrupada como escopo H-DATA-003/H-DB-003. Se a rodada anterior tinha Scope: em texto livre, ou não tinha, ela fica isolada no próprio grupo e nunca é superada pela final.
  - Em 20261021-004200-f8b0 (task complete), a rodada inicial REMEDIATION_REQUIRED cai no escopo de texto livre e a final em H-DATA-003/H-DB-003. O agregado fica REMEDIATION_REQUIRED para sempre.
  - O mesmo acontece em 20261020-153232-a61c (cycle-1 no escopo task, cycle-2 nos IDs H-*), e a r9 desta task também é agrupada em H-DATA-003/H-DB-003.
  - Além disso, Ressalvas abertas: zero não é reconhecido como campo de ressalvas, então a aprovação final da f8b0 cai em REMEDIATION_REQUIRED.
- Impacto: completedTasksApproved e latestSliceApproved ficam abaixo do real.
- Correção: extrair do Scope: só IDs de achado (P\d-\d, achado do Opus). Ignorar IDs H-* de roadmap ou frases negadas, e manter task como fallback em todas as rodadas. Também aceitar rótulos qualificados como Ressalvas abertas: e cobrir esses casos com testes.

A4 — P3 — Registros incompletos ou desatualizados sobre o andamento da task

- Onde: task.md:72–73, :84, :105–106 e :128; handoffs/implementer.md; HANDOFF-CONTEXT.md:55–58 e :98.
- Cenário:
  - As rodadas r2, r3 e r4 do P3-1 deram REMEDIATION_REQUIRED, cada uma com um achado P2, e a r5 deu APPROVE. Nenhuma das quatro aparece em task.md nem no handoff.
  - task.md:128 menciona só as rodadas 6 a 8.
  - As linhas 84 e 105–106 declaram "todos os achados aprovados, preparar prompt Opus" antes das rodadas posteriores.
  - HANDOFF-CONTEXT.md não cita a task 20261021-113450-6f2c em lugar nenhum. O prompt de continuação aponta para 20261021-064511-dedc e a última seção para 20261021-090800-c1f7.
- Impacto: quem retomar pelo HANDOFF-CONTEXT.md vai para a task errada, e o histórico do P3-1 subnotifica três rodadas de remediação.
- Correção: acrescentar as rodadas 2 a 5 em ordem cronológica e marcar as afirmações das linhas 84 e 105–106 como superadas. Atualizar também o bloco ativo e o prompt de continuação do HANDOFF-CONTEXT.md.

A5 — P3 — Os registros de review são resumos, não a saída do revisor

- Onde: task.md:26 exige "Preserve exact evidence and reviewer output".
- Cenário: os arquivos review-*.md são resumos em terceira pessoa de 300 a 1.000 bytes.
  - A clarificação do P2-3 (347 bytes) não tem Scope: nem Findings:/Caveats: e não diz literalmente "zero findings".
  - O pedido de revisão fala em "zero achados e zero ressalvas gerais", o que não está escrito no registro.
  - review-luna-hdb003-blocker-r1.md não traz verdict nem achado; diz apenas "No approval claimed".
- Impacto: não dá para verificar se os registros reproduzem a saída real do revisor, e o próprio parser não reconhece alguns deles.
- Correção: guardar a saída do revisor na íntegra, ou identificar o arquivo como resumo e apontar a saída original. Incluir campos explícitos de Scope, Verdict, Findings e Caveats.

Ressalva

- Bloqueio do webhook PostgreSQL existe só na documentação. src/lib/zap-lead/credentials.ts:184–187 chama lookupZapLeadWebhookCredential sem condição, e a rota src/app/api/zap-lead/webhook/route.ts:195 já usa esse caminho. Nada no código impede ativar a rota antes do H-DB-003. A aprovação Luna do follow-up cobriu apenas a correção documental, o que é coerente com o resto do tree em migração. Se o bloqueio precisar valer no código, sugiro uma trava que falhe fechada (rejeite a requisição) ou um aviso explícito no ponto de chamada.

O que conferi sem achado

- P2-2: nenhuma migration nova; só scripts/migrate-postgres.test.mjs foi modificado.
- P2-4: o parser de validação trata FAIL, Errors N, a contagem de falhas do Vitest e ANSI antes de procurar sinal de sucesso.
- P3-2: a checagem de Host aceita só loopback com a porta certa, a substituição do bootstrap usa callback e escapa <, e o servidor envia no-store e atualiza a cada 20 minutos.
- Clarificação do P2-3: não a trato como aprovação válida para o painel, pelos A1, A2 e A5.

Rodadas REMEDIATION_REQUIRED históricas não contam como aprovação. As aprovações registradas valem só para os respectivos achados, e esta revisão não aprova nada fora do escopo indicado.