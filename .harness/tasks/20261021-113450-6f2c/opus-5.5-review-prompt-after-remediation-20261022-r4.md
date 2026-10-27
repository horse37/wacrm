# Revisão independente integral do working tree — Opus 5.5

Faça revisão independente, completa e somente leitura do working tree atual de `C:\Sistemas\wacrm`, comparando todas as alterações locais com `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.

## Limites obrigatórios

- Não edite, formate, crie, remova, faça stage, commit, checkout, reset, restore, clean, rebase ou troca de branch.
- Não execute testes, builds, migrations, aplicação, dashboard, servidor, Docker nem consultas a banco. Use inspeção estática e evidências já existentes. Pode usar comandos somente de leitura para inventário, diff, busca e leitura de arquivos.
- Não acesse Supabase local/remoto, VPS, produção, tráfego WhatsApp/Meta, dados ou credenciais reais. Não considere PostgreSQL de produção; provas anteriores usam PostgreSQL descartável em Docker Desktop.
- Não presuma que aprovações GPT-6 Luna limitadas aprovam a tarefa ou o conjunto. Reinspecione o código e confronte cada afirmação com a evidência.
- Não atribua ao revisor execução de testes ou serviços. Diferencie o que você leu do que os logs dizem que o implementador executou.

## Identidade e inventário — executar antes de concluir

1. Confirme diretório, branch `main` e HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. Se algo divergir, pare e reporte.
2. Registre o resultado atual de `git status --short --untracked-files=all`, `git diff --stat` e `git diff --name-status`. Conte e categorize todas as entradas rastreadas alteradas e não rastreadas; não use contagens de reviews anteriores.
3. `git diff` não mostra conteúdo não rastreado: inventarie-os separadamente com `git ls-files --others --exclude-standard` e leia cada arquivo novo relevante, inclusive conteúdo de diretórios não rastreados.
4. Leia por inteiro as instruções de projeto disponíveis, `HANDOFF-CONTEXT.md`, `.harness/current-task.md`, `.harness/tasks/20261021-113450-6f2c/task.md`, `handoffs/implementer.md` e o parecer anterior `.harness/tasks/20261021-113450-6f2c/review-opus-working-tree-20261022-r2.md`.
5. Inspecione todos os diffs de código, testes, migrations, configuração e documentação; para cada caminho de evidência listado nos registros, leia o log/parecer e confronte-o com o código correspondente. Categorize artefatos históricos da Harness, mas não alegue cobertura integral se algum arquivo relevante ou evidência citada ficar sem leitura. Liste explicitamente qualquer caminho ou área que não conseguiu inspecionar. Se a cobertura for incompleta, o veredito deve ser `REMEDIATION_REQUIRED`.

## Remediações e riscos a revalidar independentemente

O parecer r2 contém cinco findings e nove caveats. Revisões Luna posteriores são limitadas a deltas. Confirme o estado atual por código, testes existentes e logs; não use este resumo como prova.

1. **P1 — rotas com PostgreSQL e privilégios:** audite cada rota que importa direta ou indiretamente repositório PostgreSQL e confirme que fica bloqueada por padrão antes de autenticação Supabase quando H-DB-003 não aprovou a matriz de grants/policies. Confira a inclusão de `/api/zap-lead/events/stream`, a ordem do middleware, HTTP 503/no-store e inexistência de fallback Supabase para escritas bloqueadas. Migration 028 cobre apenas as tabelas Zap Lead; não infira que ela provisiona a matriz completa das demais rotas/RPCs.
2. **P2 — pausa de `flow_runs`:** confirme que falha/zero-row na pausa termina a requisição antes de chamar o provedor ou persistir mensagem; compare com as policies das migrations e com o teste PostgreSQL descartável. Não presuma que exista policy/grant permanente de UPDATE.
3. **P2 — SQLSTATE `42501` em convite:** confira que apenas a rejeição intencional `exec_stmt_raise` vira erro de autenticação e que `aclcheck_error`/demais ACLs permanecem erro interno sanitizado; avalie transação, log e regressões.
4. **P3 — parser Vitest/node:test:** confira detecção de `not ok` e resumo `fail N`, precedência de falhas sobre texto de sucesso/exit code contraditório, ANSI e casos positivos/negativos.
5. **P3 — ordenação/escopo de reviews:** confira parse de hora `HHMMSS`, limites Unicode para `árvore de trabalho`, ordem por data/hora/rodada/fase, precedência de review mais recente e impedimento de aprovação ampla limpar conflito de escopo estreito.
6. **Caveat 1 — cobertura:** a revisão r2 deixou de ler muitas entradas e declarou isso como impedimento para `APPROVE`. Esta revisão deve fornecer um inventário de cobertura atual, arquivo/área por arquivo/área; não repita a lacuna. Se o volume impedir leitura integral, retorne `REMEDIATION_REQUIRED` com caminhos restantes.
7. **Caveat 2 — proveniência:** não diga que o reviewer r2 executou comandos; valide que os logs são atribuídos ao implementador.
8. **Caveat 3 — dono de migration:** confirme o contrato de owner `postgres` e que a configuração de papel alternativo falha antes de conectar, consistente com `OWNER TO postgres` nas migrations.
9. **Caveat 4 — GUC `key_id`:** trate `app.wacrm_zap_lead_webhook_key_id`, configurável pelo runtime, como defesa contra consulta acidental sem escopo; não como autenticação/isolamento independente contra runtime comprometido.
10. **Caveat 5 — ownership:** confira a guarda de conexão contra runtime dono de tabelas regulares/particionadas de schemas não sistêmicos, inclusive tabelas RLS sem `FORCE`, e limites da checagem.
11. **Caveat 6a — janela temporal:** confirme que `onConnect` roda por conexão física nova, não atomicamente por consulta, e que administrador PostgreSQL é autoridade confiável capaz de mudar papel/policies.
12. **Caveat 6b — painel:** confirme propagação de falhas de leitura de tasks/reviews/evidências como HTTP 500 sanitizado; apenas ausência `ENOENT` explicitamente opcional pode virar ausência de dados.
13. **Caveat 7 — webhook:** flag `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED` só habilita o lookup PostgreSQL quando exatamente `1`; ausente/outro valor deve falhar fechado com HTTP 503 antes de ler requisição ou consultar credenciais. Verifique que a documentação não sugere persistência PostgreSQL dos recibos nem fallback.
14. **Caveat 8 — migration 028:** confirme que `supabase/migrations/028_zap_lead_runtime_read_policies.sql` cria policies com RLS forçada e grants mínimos por coluna nas duas tabelas Zap Lead, mas exige `wacrm_runtime` preexistente e não cria o papel nem fecha a matriz global.
15. **Caveat 9 — automação:** confirme chamadores de produção: a rota `GET /api/automations/[id]/logs` usa o leitor PostgreSQL `automation-logs`; repositórios PostgreSQL de escrita/fila sem chamadores em `src` não são produção integrada. Compare com `supabaseAdmin` em `src/lib/automations/engine.ts` e `src/app/api/automations/cron/route.ts`; confirme o limite das policies client-side em migrations 006/017 e ausência de grants/policies `wacrm_runtime` de escrita nessas tabelas.

## Evidências recentes para confrontar

Leia os registros e logs efetivamente citados em `task.md` e `handoffs/implementer.md`, incluindo, sem se limitar a:

- `review-opus-c8-migration-boundary-independent-20261022.md` e `validation-opus-c8-migration-boundary-20261022.log`;
- `review-opus-c9-automation-runtime-boundary-independent-20261022.md` e `validation-opus-c9-automation-runtime-boundary-20261022.log`;
- `review-opus-c7-webhook-fail-closed-documentation-independent-20261022.md` e `validation-opus-c7-webhook-fail-closed-documentation-20261022.log`;
- `review-opus-c6b-task-review-read-independent-20261022.md` e `validation-opus-c6b-task-review-read-20261022.log`;
- `review-opus-f1-event-stream-gate-independent-20261022.md` e `validation-opus-f1-zap-lead-event-stream-gate-20261022.log`;
- evidências PostgreSQL descartáveis citadas nos registros de finding 1–3 e caveats 3–5. Confirme que são fixtures descartáveis e não equivalem a provisionamento em ambiente persistente.

## Formato obrigatório do parecer

Comece com exatamente um veredito: `APPROVE` ou `REMEDIATION_REQUIRED`. Informe quantidade de findings e caveats. Liste branch/HEAD, inventário atual, escopo efetivamente lido e cobertura por categoria, evidências consultadas, limitações e qualquer caminho não lido.

Para cada finding, informe prioridade, arquivo e linha atuais, cenário, impacto, causa, correção mínima e teste/log relevante. Separe defeitos de código de ressalvas de cobertura/processo. Se não houver findings nem caveats e a cobertura for integral, declare explicitamente `0 findings` e `0 caveats`, limitando o parecer ao working tree revisado. Qualquer finding, caveat, divergência de base ou arquivo relevante não lido exige `REMEDIATION_REQUIRED`.

Não aprove a task inteira, H-DATA-003 ou H-DB-003 globalmente; o parecer vale apenas para o estado e o escopo que você realmente inspecionou.
