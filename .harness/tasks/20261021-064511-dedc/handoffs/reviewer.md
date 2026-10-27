# Revisão interna — 20261021-064511-dedc

- **Status:** APPROVE para a fatia `flow_runs` de `POST /api/whatsapp/send`; nenhum achado no escopo revisado.
- **Correção:** a operação mantém SQL parametrizado, valida UUID/data, define `auth.uid()` apenas na transação, filtra por conta/contato/estado `active` e valida no máximo uma linha. A rota executa depois do aceite e mantém resposta de sucesso se atualização best-effort falhar.
- **Testes lidos:** unitários cobrem parâmetros, sem linha, entradas inválidas, falha e múltiplas linhas; rota cobre ordem pós-aceite, erro best-effort e não executar quando provedor rejeita; integração verifica persistência, estado não ativo, RLS, isolamento e limpeza de identidade.
- **Validações:** Vitest 29/29, TypeScript, ESLint sem avisos, Prettier, sintaxe Node/PowerShell, PostgreSQL 16 descartável forced-RLS e `git diff --check` passaram; sem containers residuais.
- **Limite:** migrations atuais não oferecem policy UPDATE de `flow_runs`; fixture aplica policy/grant temporários para provar o comportamento. Matriz permanente do runtime segue H-DB-003; esta revisão não declara prontidão de implantação nem aprovação global.
- **Pendente:** revisão independente GPT-6 Luna read-only.
