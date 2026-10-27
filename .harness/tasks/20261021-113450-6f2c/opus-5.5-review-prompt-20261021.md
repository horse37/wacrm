# Prompt para revisão independente — Opus 5.5

Faça uma revisão de código independente, rigorosa e somente leitura do estado atual do repositório WACRM.

## Identificação e base

- Repositório: `C:\Sistemas\wacrm`
- Branch esperada: `main`
- HEAD-base: `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`
- Task Harness ativa: `20261021-113450-6f2c`, status `in_progress`.
- Relatório Opus anterior completo: `.harness/tasks/20261021-113450-6f2c/review-opus-working-tree-20261021.md` (também preservado em `.txt`).
- Task, handoff, histórico de revisões e evidências: `.harness/tasks/20261021-113450-6f2c/`.

Revise o estado completo desde o HEAD-base: alterações rastreadas, arquivos não rastreados e artefatos da task. `git diff` sozinho não inclui arquivos não rastreados; confira o inventário completo do Git e abra os arquivos relevantes. Não suponha que os resumos deste prompt ou aprovações de fatias substituam a inspeção do código e das evidências.

## Achados Opus anteriores e correções a reavaliar

O relatório anterior registrou cinco achados:

1. **A1 — parser de vereditos:** conteúdo entre crases em campos `Verdict`/`Result` era removido, fazendo `APPROVE` e `REMEDIATION_REQUIRED` virarem `pendente`. A correção preserva valores inline nesses campos e mantém filtragem de exemplos/código para vereditos e contagens. Confira também casos de exemplos, blocos cercados e código Markdown indentado, além de conflitos reais. Revisões independentes e regressões estão nos arquivos `review-p3-1-a1-independent-r*.md` e nos testes do dashboard.
2. **A2 — painel desatualizado:** o servidor/estado servido precisava refletir o código atual e o estado real da task. O painel foi reiniciado pelo proprietário em `http://127.0.0.1:49214/dashboard.html`; a API deve mostrar a task `20261021-113450-6f2c`, `in_progress`, branch/HEAD esperados e a próxima ação atual. Verifique API e HTML ao vivo, sem reiniciar processos. Evidências e revisões estão em `validation-a2-dashboard-live-20261021.log` e `review-a2-independent-20261021-r*.md`.
3. **A3 — agrupamento de escopos:** disclaimers em `Scope:` não devem criar escopos falsos nem separar incorretamente uma remediação e sua aprovação. Revise normalização, regressões e a agregação resultante. Ver `review-a3-independent-20261021-r*.md`.
4. **A4 — histórico e continuidade:** rodadas intermediárias e ações superadas precisavam ser preservadas e identificadas sem deixar instruções antigas como próximas ações. Confira task, handoff e `HANDOFF-CONTEXT.md`. Ver `review-a4-independent-20261021-r*.md`.
5. **A5 — proveniência:** distinguir saídas integrais de resumos/metadados do implementador, desambiguar respostas em threads compartilhados e reconciliar os registros persistidos. O índice agora lista 41 pareceres Luna; duas respostas A3 sem arquivo local continuam identificadas separadamente, sem serem inventadas como verbatim. Ver `review-provenance-index.md` e `review-a5-independent-20261021-r*.md`.

O follow-up Opus também levantou dois pontos H-DB-003:

- A leitura da credencial webhook depende de papel, grants mínimos e policy RLS ainda não provisionados pelas migrations aprovadas. O bloqueio foi documentado: não ativar nem implantar esse fluxo até H-DB-003. Não há alteração permanente de schema, RLS ou grants. A aprovação Luna registrada (`review-luna-hdb003-blocker-r2.md`) cobre somente esse bloqueio documental.
- A integração PostgreSQL usa fixture sintética, não prova paridade da cadeia de migrations instalável. As diferenças de role/policy/security mode foram listadas e a cobertura para isolamento entre contas, event-stream, registration e limpeza dos GUCs foi ampliada. A integração descartável PostgreSQL 16 passou; `review-luna-fixture-contract.md` aprova somente a documentação/cobertura da fixture, não a cadeia real nem prontidão operacional.

Por fim, a ressalva de fail-closed do webhook foi tratada separadamente: `POST /api/zap-lead/webhook` exige `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED === '1'` antes de ler headers/corpo, consultar credenciais ou persistir. O teste cobre flag ausente, vazia e `true`, verifica que `body.getReader()` não é chamado e confirma que os mocks de credencial/persistência ficam sem chamadas. Validação 20/20 e parecer independente `APPROVE` limitado estão em `validation-webhook-fail-closed-r2-20261021.log` e `review-webhook-fail-closed-independent-20261021-r2.md`.

## Escopo da revisão

- Inspecione o diff completo e os arquivos novos pertinentes, buscando regressões funcionais, falhas de segurança, erros de autorização/isolamento por conta, SQL, compatibilidade, tratamento de erro, testes insuficientes e documentação que contradiga o estado real.
- Reavalie especificamente os cinco achados originais, os dois achados do follow-up H-DB-003 e a guarda fail-closed, sem limitar a revisão a essa lista. Investigue qualquer outro risco material no conjunto alterado.
- Confirme que os registros de review são atribuídos corretamente e que nenhuma aprovação de fatia é apresentada como aprovação da task inteira.
- Informe achados com severidade, arquivo/linha, cenário concreto, impacto e correção mínima. Separe achados de limitações/ressalvas, e cite evidências verificáveis.

## Limites obrigatórios

- Revisão somente leitura: não edite arquivos, não mude Git, não faça commit, push ou deploy e não reinicie o painel.
- Não execute testes nem inicie/pare Docker durante a revisão.
- Não acesse Supabase, VPS, produção, rede/serviços externos, tráfego real, dados reais ou credenciais reais. PostgreSQL descartável em Docker Desktop é o único banco permitido em trabalho de implementação, mas esta revisão não precisa se conectar a banco.
- H-DATA-003, H-DB-003, integração real, Auth/session provider, Storage, Realtime, consumo externo, tráfego de aplicação e produção continuam fora de aprovação global.
- Não transforme limitações explicitamente aceitas em aprovações implícitas. Se não conseguir inspecionar todo o conjunto ou evidência, declare a limitação e não aprove sem ressalvas.

## Veredito exigido

Retorne `APPROVE` somente se não houver nenhum achado acionável e nenhuma ressalva no escopo completo revisado. Caso contrário, retorne `REMEDIATION_REQUIRED` e enumere todos os achados/ressalvas concretos. Declare explicitamente que o veredito se limita ao estado revisado e não aprova a task Harness inteira nem H-DATA-003/H-DB-003 globalmente.
