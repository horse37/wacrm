# Task — Migração PostgreSQL da rota de disparo em massa WhatsApp
- id: 20261021-011547-2ff4
- type: migration
- slug: postgres-whatsapp-broadcast-route
- status: in_progress
- roadmap: H-DATA-003, phase 03

## Objetivo
Migrar somente as leituras locais de conta, configuração WhatsApp e definição do template usadas por POST /api/whatsapp/broadcast para guards e repositórios PostgreSQL existentes.

## Contexto
A rota usa Supabase SSR para sessão e PostgREST para dados locais. Já existem os repositórios PostgreSQL da configuração WhatsApp e da definição de template de envio, com testes e evidências PostgreSQL 16 descartáveis/RLS forçado. A fatia anterior POST /api/whatsapp/templates/sync recebeu GPT-6 Luna read-only APPROVE, zero achados e zero ressalvas, limitada àquela rota.

## Escopo
- Migrar resolução account-scoped, leitura da configuração de envio e leitura da definição do template para PostgreSQL.
- Preservar sessão atual, rate limit, validação, montagem dos destinatários, tratamento por destinatário, chamadas e payloads existentes de sendTemplateMessage e envelope de resposta.
- Criar testes focados da rota. Auth, repositórios e sendTemplateMessage serão simulados; nenhum envio externo real.

## Fora do escopo
- Envio real Meta/WhatsApp, banco Supabase, alteração de outros endpoints, engine, Storage, Realtime, substituição de Auth, mudanças em repositórios/SQL/schema/RLS/grants, VPS, produção, tráfego, dados/credenciais reais, commit, push, deploy ou operações Git destrutivas.
- Aprovação global de H-DATA-003/H-DB-003.

## Implementação
- Removidas as leituras PostgREST de `profiles`, `whatsapp_config` e `message_templates` desta rota. A sessão SSR continua sendo a fonte de identidade; os repositórios existentes resolvem e restringem cada leitura à conta atual.
- `getConnectionConfig` fornece `phoneNumberId` e o ciphertext para descriptografia local. `findForCurrentAccount` recebe nome e idioma do template; DTO validado continua chegando a `sendTemplateMessage`.
- Mantidos rate limit, formatos de entrada, validação, destinatários, tentativas por variante, chamadas, payloads e envelope da resposta. Erros dos repositórios são convertidos em mensagens seguras e status por código.
- Auth SSR, repositórios e provedor são simulados nos testes. Nenhum envio externo é executado.

## Validação
- TDD RED pré-implementação: `npm exec -- vitest run src/app/api/whatsapp/broadcast/route.test.ts --reporter=verbose` saiu com código 1 enquanto a rota ainda usava leituras PostgREST; dois dos três testes focados falharam como esperado.
- Pós-implementação: teste focado da rota passou 6/6; TypeScript (`npm run typecheck`), ESLint direcionado com `--max-warnings=0` e Prettier check dos dois arquivos passaram. Comandos/resultados: `validation-broadcast-route-20261021.log`.
- Repositórios e SQL não foram alterados nesta fatia; foram reutilizadas provas Docker PostgreSQL 16 descartáveis já existentes: `.harness/tasks/20261019-230941-5159/validation-postgres-whatsapp-config-8b9cf61413.log` e `.harness/tasks/20261020-031751-9e7d/validation-postgres-template-send-81e8e8dad8.log`. Ambas registram forced RLS, escopo entre contas, grants mínimos e cleanup; esta rota foi testada com repositórios simulados.
- `git diff --check` completo passou. Revisões interna e independente GPT-6 Luna read-only retornaram `APPROVE`, zero achados e zero ressalvas, limitadas a esta fatia. Registros: `internal-review-20261021.md` e `review-gpt6-luna-final-20261021.md`.

## Próxima ação
A fatia está aprovada no escopo limitado. Manter H-DATA-003/H-DB-003 sem aprovação global e avançar para a próxima fatia estreita de migração PostgreSQL.

## Limites
Preservar alterações locais existentes; manter `main` e HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. Sem operação Git destrutiva, commit, push ou deploy. PostgreSQL descartável no Docker Desktop é o único banco permitido; sem Supabase, VPS, produção, tráfego, dados ou credenciais reais. H-DATA-003/H-DB-003 permanecem sem aprovação global. Parar exatamente às 09:00 BRT de 22/10/2026.
