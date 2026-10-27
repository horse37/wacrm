# Handoff — migração PostgreSQL da sincronização de modelos WhatsApp

- Task: `20261021-004200-f8b0`, H-DATA-003 phase 03.
- Rota escopada: `POST /api/whatsapp/templates/sync`.
- Branch/HEAD: `main` / `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.

## Implementação e validação

- A rota lê sessão por Auth existente e migra dados locais para os guards/repositórios PostgreSQL já aprovados. Nenhuma consulta Supabase de dados permanece no handler.
- TDD RED inicial: 6 falhas esperadas/1 aprovação em 7 testes; ver `tdd-red-route.log`.
- A primeira revisão independente encontrou P2: `paging.next` não era restringido e podia receber o bearer token em outra origem.
- Correção valida HTTPS, origem `https://graph.facebook.com`, userinfo vazio e caminho `/v21.0/`; rejeita URL inválida com 502 antes da persistência.
- Teste de regressão cobre origem externa, HTTP, userinfo e versão diferente; Vitest focado agora 46/46.
- Revalidação em 01:04 BRT: TypeScript, ESLint direcionado com `--max-warnings=0`, Prettier e `git diff --check` passaram; ver `validation-focused-sync-route-20261021.log`.
- Prova PostgreSQL 16 descartável/RLS forçado reutilizada; SQL, repositórios, RLS e grants não mudaram. Docker não foi iniciado nesta fatia.
- Prova PostgreSQL 16 descartável/RLS forçado reutilizada, sem mudança de repositório/SQL/RLS/grants; Docker não foi iniciado nesta fatia.

## Próxima ação

Fatia `POST /api/whatsapp/templates/sync` encerrada após segunda revisão independente GPT-6 Luna read-only `APPROVE`, zero achados e zero ressalvas; relatório em `review-gpt6-luna-final-20261021.md`. Continuar próxima fatia estreita H-DATA-003 em task separada. Aprovação limitada à rota; H-DATA-003/H-DB-003 seguem sem aprovação global.

## Limites

PostgreSQL sintético descartável no Docker Desktop é o único banco permitido. Reutilizar evidência PostgreSQL existente se repositórios/SQL/RLS/grants não mudarem. Não acessar Supabase, Meta/Auth real, VPS, produção, tráfego, dados ou credenciais reais. Sem schema/RLS/grants, outras rotas, Auth replacement, Storage, Realtime, commit, push, deploy ou operações Git destrutivas. H-DATA-003/H-DB-003 seguem sem aprovação global. Encerrar às 09:00 BRT de 21/10/2026.
