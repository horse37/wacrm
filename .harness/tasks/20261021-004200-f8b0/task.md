# Task — Migração PostgreSQL da sincronização de modelos WhatsApp

- id: `20261021-004200-f8b0`
- type: `migration`
- slug: `postgres-whatsapp-template-sync-route`
- status: `complete`
- roadmap: H-DATA-003, phase 03

## Objetivo

Migrar somente a persistência local de `POST /api/whatsapp/templates/sync` para guards e repositórios PostgreSQL existentes.

## Contexto

A rota ainda consulta `profiles`, `whatsapp_config` e `message_templates` pelo cliente Supabase. Já existem guards PostgreSQL, leitura do contexto/configuração de ciclo de vida e repositório `template-sync-persistence`; a persistência passou por prova PostgreSQL 16 sintética com RLS forçado nas tasks `20261020-034647-d1e1` e `20261020-033829-58ee`. A fatia anterior, `POST /api/whatsapp/templates/submit`, recebeu revisão independente GPT-6 Luna `APPROVE`, zero achados e zero ressalvas abertas.

## Escopo

- Migrar apenas leitura local de conta/configuração e insert/update de `message_templates` nesta rota para guards e repositórios PostgreSQL existentes.
- Preservar autenticação por sessão verificada no servidor, gate admin necessário às gravações, leitura/decrypt da configuração, busca paginada da Meta, normalização de status/categoria/botões/amostras/qualidade, resposta e erros por template.
- Criar testes focados da rota com Auth, fetch Meta e repositórios simulados; nenhuma chamada externa real.

## Fora do escopo

- Outras rotas, telas ou mudança dos repositórios existentes; Auth replacement; migration/schema/RLS/grants; chamadas Meta reais; banco Supabase como persistência ou validação; VPS, produção, tráfego, dados/credenciais/chips reais, Storage, Realtime, commit, push ou deploy.
- Aprovação global de H-DATA-003/H-DB-003.

## Validação

- Começar com teste RED direcionado da rota.
- Rodar Vitest da rota e dos repositórios usados; TypeScript; ESLint direcionado com `--max-warnings=0`; Prettier check e `git diff --check`.
- Reusar a evidência Docker PostgreSQL 16 sintética/RLS forçado dos repositórios, desde que nenhum arquivo de repositório, SQL, RLS ou grants seja alterado. Caso contrário, rodar somente fixture descartável com `--network none`, cleanup verificado e sem recursos persistentes.
- Congelar diff/evidências e obter revisão independente GPT-6 Luna read-only até `APPROVE`, zero achados e zero ressalvas; corrigir achados e repetir validações/review.

## Próxima ação

Fatia encerrada após segunda revisão independente GPT-6 Luna read-only `APPROVE`, zero achados e zero ressalvas abertas. Continuar a próxima fatia estreita H-DATA-003 em task separada; não interpretar esta conclusão como aprovação global.

## Implementação e validação

- `POST /api/whatsapp/templates/sync` agora usa guard PostgreSQL com sessão verificada, leitura mínima de configuração WhatsApp e repositório PostgreSQL de sincronização. A rota não consulta nem grava tabelas via Supabase.
- Preservados gate administrativo antes de ler configuração ou chamar Meta, decrypt local, paginação limitada a 20 páginas, normalização, contagem de inserts/updates, erros por item e envelope de resposta. Testes simulam Auth, Meta e repositórios; nenhuma chamada real foi feita.
- TDD RED: 6 falhas esperadas e 1 caso de sessão sem autenticação aprovado contra o handler legado; `.harness/tasks/20261021-004200-f8b0/tdd-red-route.log`.
- Vitest focado: 42/42; TypeScript, ESLint direcionado com zero avisos, Prettier e `git diff --check` passaram. Evidência: `.harness/tasks/20261021-004200-f8b0/validation-focused-sync-route-20261021.log`.
- Reutilizada evidência PostgreSQL 16 descartável já aprovada para os repositórios inalterados de sync e configuração. Nenhum Docker foi iniciado nesta fatia.
- A primeira revisão independente apontou P2: `paging.next` podia encaminhar o bearer token a uma origem arbitrária. A correção exige HTTPS, origem Graph exata, versão `v21.0` e ausência de userinfo; URL inválida retorna 502 antes de persistir qualquer template. Regressão cobre host externo, HTTP, userinfo e versão incorreta. Relatório: `.harness/tasks/20261021-004200-f8b0/review-gpt6-luna-initial-20261021.md`.
- Validação final após a correção: Vitest focado 46/46, TypeScript, ESLint direcionado com zero avisos, Prettier e `git diff --check` aprovados; execução em 01:04 BRT registrada no log.

A segunda revisão independente GPT-6 Luna retornou `APPROVE`, zero achados e zero ressalvas para esta rota; registro: `.harness/tasks/20261021-004200-f8b0/review-gpt6-luna-final-20261021.md`. H-DATA-003/H-DB-003 continuam sem aprovação global.

## Limites

Preservar todas as alterações locais. Permanecer em `main` e no HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. Usar somente PostgreSQL sintético descartável no Docker Desktop; sem Supabase, Meta/Auth real, VPS, produção, tráfego, dados ou credenciais reais. Não fazer operação Git destrutiva, commit, push ou deploy. Parar às 09:00 BRT de 21/10/2026 e registrar o ponto exato de retomada.
