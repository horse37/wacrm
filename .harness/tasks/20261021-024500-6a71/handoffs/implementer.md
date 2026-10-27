# Ponto de continuidade — WhatsApp template submit

## Estado

- Task `20261021-024500-6a71`, H-DATA-003 fase 03, implementação concluída; revisão independente GPT-6 Luna ainda pendente.
- Branch `main`, HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. Preservar todas as alterações locais existentes.
- Escopo limitado ao `POST /api/whatsapp/templates/submit`; Meta/Auth são mockados nos testes.

## Mudanças

- Removidas consultas e gravações Supabase de `profiles`, `whatsapp_config` e `message_templates` do handler.
- Contexto/admin, configuração e persistência usam guards/repositórios PostgreSQL existentes. Gate admin precede configuração, upload de handle e efeito Meta; gravação revalida admin/conta na transação.
- Cobertos sucesso, dry-run, acesso negado, payload inválido, configuração/WABA ausentes, falha Meta, rate limit e falha de persistência local.

## Validações

- Vitest: 57/57 em quatro arquivos.
- `npm run typecheck`, ESLint focado com `--max-warnings=0`, Prettier e `git diff --check`: passaram.
- SQL/repositório não mudou; evidência Docker Desktop PostgreSQL 16 com RLS forçado reutilizada: `.harness/tasks/20261020-035839-2f1e/validation-postgres-template-submit-persistence-8580d82154.log`.
- Log de validação focada: `../validation-route-submit-postgres-wiring-20261021.log`; TDD RED: `../tdd-red-route.log`.

## Revisão final e próxima ação
- Revisão independente GPT-6 Luna read-only: `APPROVE`, zero achados e zero ressalvas abertas, limitada ao `POST /api/whatsapp/templates/submit`; relatório `../review-gpt6-luna-final-20261021.md`.
- P2 da resposta com metadados corrigido e validado; evidência de grants continua limitada à fixture PostgreSQL descartável.
- Próxima fatia: task separada para `POST /api/whatsapp/templates/sync`. H-DATA-003/H-DB-003 seguem sem aprovação global.

## Limites

Somente PostgreSQL sintético descartável no Docker Desktop. Sem banco Supabase, Meta/Auth real, VPS, produção, tráfego, dados/credenciais reais, schema/RLS/grants, Storage, Realtime, commit, push ou deploy. H-DATA-003/H-DB-003 seguem sem aprovação global. Parar às 09:00 BRT de 21/10/2026 com ponto de retomada registrado.

## Atualização — remediação P2 (2026-10-21)

- Review independente anterior apontou que a resposta de sucesso omitia `created_at`, `updated_at` e `quality_score` do registro legado. Valores não são derivados em código: `template-submit-persistence` agora os lê via `RETURNING` explícito e valida timestamps/score antes de devolver; handler mantém o envelope `{ success, template, dry_run }` e retorna os metadados persistidos. Sem `RETURNING *`.
- Escopo foi ampliado apenas para esta projeção do repositório e prova de privilégio mínimo na fixture sintética. Nenhum grant permanente, migration, schema ou policy/RLS foi alterado. Grants de `SELECT` nas três colunas existem somente nas fixtures; provisionamento de privilégios fora do Docker descartável segue fora do escopo.
- Testes focados: 57/57. TypeScript, ESLint com `--max-warnings=0`, Prettier, `node --check`, AST PowerShell e `git diff --check` passaram.
- PostgreSQL 16 descartável passou com RLS forçado, papel `NOBYPASSRLS`, metadados de insert/update, `quality_score` preexistente preservado, rede isolada e cleanup confirmado. Evidência: `validation-postgres-template-submit-persistence-051a0febf9.log`.
- Task desta fatia concluída após aprovação independente GPT-6 Luna. Não declarar aprovação global de H-DATA-003/H-DB-003. Parar às 09:00 BRT de 21/10/2026 com ponto de retomada registrado.
