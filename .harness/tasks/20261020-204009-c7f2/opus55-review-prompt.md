# Prompt — review independente Opus 5.5

Copie o texto abaixo para uma sessão independente Claude Opus 5.5:

```text
Você é revisor independente de código. Faça revisão somente leitura, sem editar arquivos, aplicar patches, formatar, executar testes, alterar Git, nem iniciar/parar containers ou serviços.

Repositório: C:\Sistemas\wacrm
Branch esperada: main
HEAD esperado: 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c
Task: 20261020-204009-c7f2 — postgres-flow-create-route — H-DATA-003 fase 03.
Escopo exato: wiring de POST /api/flows para persistência PostgreSQL, mantendo a autenticação atual de sessão verificada, criação de draft e clonagem de template.

Revise o diff e o código efetivo da rota POST /api/flows, seus testes focados, e as evidências listadas em:
- .harness/tasks/20261020-204009-c7f2/task.md
- .harness/tasks/20261020-204009-c7f2/handoffs/implementer.md
- .harness/tasks/20261020-204009-c7f2/review-gpt6-luna-final-20261020.md
- .harness/tasks/20261020-204009-c7f2/validation-focused-tests.log
- .harness/tasks/20261020-204009-c7f2/validation-typecheck.log
- .harness/tasks/20261020-204009-c7f2/validation-eslint.log
- .harness/tasks/20261020-204009-c7f2/validation-prettier.log
- .harness/tasks/20261020-204009-c7f2/validation-diff-check.log
- .harness/tasks/20261020-052532-c1b8/validation-postgres-flow-create-bbdff29cdb.log

Inspecione também as dependências necessárias para avaliar o contrato da rota, incluindo o repositório PostgreSQL já aprovado, sem ampliar seu veredito para outros slices. Worktree contém alterações locais de muitas tasks; ignore tudo que não seja necessário para avaliar este POST e suas dependências diretas. Não exija aprovação global da migração.

Verifique especialmente:
1. Sessão verificada é obrigatória e o user ID usado no repositório vem somente dela.
2. Draft e clonagem usam o repositório PostgreSQL; a rota não lê/grava dados via Supabase nem usa admin writes.
3. Isolamento por conta/tenant, papel e ownership não são enfraquecidos pelo wiring; erros de auth, autorização, validação, conflito, ausência e DB são tratados sem vazar detalhes internos.
4. Clonagem de template preserva o payload esperado e persistência atômica existente; resposta HTTP 201 e `{ flow: { id } }` permanecem compatíveis com a UI.
5. Testes focados cobrem autenticação, delegação/identidade, template, erros e ausência de chamadas Supabase de dados/admin.
6. Evidências registradas são coerentes e não fazem alegações além do que foi executado.

Limites: banco permitido para o projeto é PostgreSQL descartável no Docker Desktop; esta revisão não requer nem deve acessar Supabase, qualquer serviço remoto, VPS, produção, tráfego, dados ou credenciais reais. H-DATA-003/H-DB-003 permanecem in_progress e não aprovadas globalmente. Auth/session replacement, Storage, Realtime e outras rotas não pertencem a este slice.

Responda com um único veredito:
- `APPROVE` somente se não houver achados acionáveis nem ressalvas, limitado ao slice acima; ou
- `REMEDIATION_REQUIRED`, listando cada achado com severidade, arquivo/linha, evidência, impacto e correção mínima. Se faltar evidência, declare como ressalva em vez de inferir sucesso.

Não declare a task global concluída nem a migração inteira aprovada.
```
