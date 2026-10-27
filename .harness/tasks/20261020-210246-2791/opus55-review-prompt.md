# Prompt — revisão independente Opus 5.5

Copie o bloco abaixo para uma sessão independente Claude Opus 5.5.

```text
Você é revisor independente de código. Faça uma revisão somente leitura. Não edite, formate ou crie arquivos; não aplique patches; não execute testes; não altere Git; não inicie nem pare containers ou serviços.

Repositório: C:\Sistemas\wacrm
Branch esperada: main
HEAD esperado: 7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c
Task: 20261020-210246-2791 — postgres-whatsapp-config-delete-route — H-DATA-003, fase 03.

## Escopo exato

Revise somente a migração do handler `DELETE /api/whatsapp/config` para persistência PostgreSQL por conta, preservando a verificação de sessão existente e o contrato `{ success: true }`. GET e POST não fazem parte desta slice.

O worktree já contém muitas alterações locais de outras tasks. Isole o diff e o comportamento desta slice pelos arquivos, testes e evidências da task abaixo. Não atribua à slice nem reporte como defeito alterações não relacionadas. Não tente limpar ou rearranjar o worktree.

## Evidências a ler

- `.harness/tasks/20261020-210246-2791/task.md`
- `.harness/tasks/20261020-210246-2791/handoffs/implementer.md`
- `.harness/tasks/20261020-210246-2791/review-gpt6-luna-final-20261020.md`
- `.harness/tasks/20261020-210246-2791/red-tests-delete-20261020.log`
- `.harness/tasks/20261020-210246-2791/validation-focused-tests.log`
- `.harness/tasks/20261020-210246-2791/validation-typecheck.log`
- `.harness/tasks/20261020-210246-2791/validation-eslint.log`
- `.harness/tasks/20261020-210246-2791/validation-prettier-files.log`
- `.harness/tasks/20261020-210246-2791/validation-prettier-final.log`
- `.harness/tasks/20261020-210246-2791/validation-diff-check.log`
- `.harness/tasks/20261020-210246-2791/validation-runner-parse.log`
- `.harness/tasks/20261020-210246-2791/validation-docker-runner.log`
- `.harness/tasks/20261020-210246-2791/validation-postgres-whatsapp-config-delete-b9ce3c1ef2.log`

Inspecione também o código efetivo do handler DELETE, o método PostgreSQL chamado por ele, a política RLS já existente para `whatsapp_config_delete` e os testes focados correspondentes. Confira o diff da slice contra o comportamento anterior sem assumir que a evidência, o review anterior ou o estado do dashboard provam a correção.

## Perguntas de revisão

1. A rota mantém verificação server-side da sessão antes de acessar o banco? A identidade usada em `auth.uid()` é derivada do usuário autenticado verificado, sem aceitar identidade/conta do request?
2. A operação exige papel permitido pela política existente e fica limitada à conta do usuário autenticado, sem leitura/escrita cross-account?
3. A transação define a identidade RLS localmente e evita vazamento dessa identidade ao reutilizar conexão do pool, inclusive em falha?
4. A query é parametrizada e a exclusão usa vínculo/escopo de conta confiável? Exclusão repetida ou ausência de configuração preserva o contrato de sucesso documentado?
5. Erros de autenticação, autorização e banco são mapeados com segurança, sem expor SQL, credenciais ou detalhes internos?
6. Os testes cobrem delegação ao repositório PostgreSQL, conta/admin, não-admin, cross-account, identidade transacional e contrato HTTP, e demonstram que DELETE não usa persistência Supabase/admin? GET e POST permanecem fora do diff desta slice?
7. A evidência PostgreSQL descartável é coerente com o código: PostgreSQL 16, forced RLS, papel `NOBYPASSRLS`, grants/policy limitados, dados sintéticos, rede isolada e sem recursos residuais?

Considere validações e limites reportados como evidência a conferir. A prova usa PostgreSQL descartável no Docker Desktop. Não há Supabase local/remoto, VPS, produção, tráfego real, dados reais nem credenciais reais nesta validação.

## Veredito obrigatório

Responda `APPROVE` somente se não houver achados nem ressalvas aplicáveis a esta slice. Caso contrário, responda `REMEDIATION_REQUIRED` e liste cada achado com severidade, arquivo/linha, impacto, evidência reproduzível ou raciocínio preciso e a menor correção necessária. Separe achados de ressalvas; declare explicitamente qualquer evidência ausente ou não verificável. Não invente falhas e não rebaixe defeitos concretos a ressalvas.

A aprovação, se concedida, limita-se a este diff de DELETE. Não declare a task HARNESS inteira concluída, nem H-DATA-003/H-DB-003 aprovados; migração global, Auth, Supabase real, Storage, Realtime, tráfego de aplicação e produção permanecem fora do escopo.
```
