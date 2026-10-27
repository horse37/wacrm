# Task — PostgreSQL WhatsApp template delete route

- id: `20261021-003953-b27d`
- type: `migration`
- slug: `postgres-whatsapp-template-delete-route`
- status: `complete`
- roadmap: H-DATA-003, phase 03

## Goal

Migrar somente a persistência local de `DELETE /api/whatsapp/templates/[id]` para repositórios PostgreSQL por conta, mantendo o comportamento atual da rota.

## Context

A fatia anterior `GET /api/whatsapp/config/verify-registration` recebeu revisão independente GPT-6 Luna `APPROVE`, limitada àquela rota. O handler DELETE ainda consulta `profiles`, `message_templates` e `whatsapp_config` diretamente pelo cliente Supabase. Repositórios PostgreSQL de contexto, configuração e exclusão do template já existem e possuem prova sintética descartável.

## In scope

- Migrar somente acessos locais a dados executados pelo handler DELETE; manter autenticação existente, sem consultar tabelas Supabase para dados.
- Reusar repositórios existentes e preservar isolamento por conta/criador, UUID inválido, not-found, dry-run, configuração/decrypt e comportamento Meta.
- Verificar o papel admin antes de qualquer exclusão remota Meta, pois a persistência PostgreSQL local também exige admin; manter a checagem dentro da transação de exclusão.
- Cobrir autorização, conta sem vínculo, template ausente ou de outra conta, configuração ausente, falha Meta, exclusão local e falha genérica do banco.
- Mockar Auth e Meta nos testes; provar os repositórios com PostgreSQL sintético descartável no Docker Desktop.

## Out of scope

- Handler PATCH, rotas submit/sync e outros domínios; alteração de Auth, migrations/schema/RLS/grants, Storage, Realtime; chamada Meta real; banco Supabase local/remoto; VPS, produção, credenciais/dados/chips reais, tráfego, commit, push ou deploy.
- Não declarar aprovação global de H-DATA-003/H-DB-003.

## Validation

- Iniciar com teste RED da rota; depois `npx vitest run src/app/api/whatsapp/templates/[id]/route.test.ts` e os testes dos repositórios usados.
- Executar `npm run typecheck`, ESLint direcionado com `--max-warnings=0`, Prettier check e `git diff --check` nos arquivos da fatia.
- Provar os repositórios em PostgreSQL 16 sintético e descartável no Docker Desktop, rede isolada, sem Supabase e com limpeza completa.
- Após congelar código e evidências, revisão independente read-only GPT-6 Luna; corrigir e repetir até `APPROVE`, zero achados e zero ressalvas.

## Next action

Fatia encerrada após revisão independente GPT-6 Luna `APPROVE`, sem achados nem ressalvas. Próxima fatia: 20261021-013249-b008, PATCH /api/whatsapp/templates/[id].

## Implementation and validation progress

- O handler `DELETE` agora mantém Auth existente, usa repositórios PostgreSQL para contexto/configuração/exclusão e verifica admin antes de qualquer efeito remoto Meta. O repositório de exclusão também revalida o papel e a conta dentro da transação. Os acessos Supabase restantes neste arquivo pertencem ao handler `PATCH`, fora do escopo.
- `src/app/api/whatsapp/templates/[id]/route.test.ts` cobre UUID inválido, autenticação, template ausente/de outra conta, conta sem vínculo, autorização antes de Meta/exclusão local, exclusão local, configuração ausente, falha Meta e erro de banco. Auth, Meta e repositórios são mockados.
- `src/lib/repositories/template-delete-persistence.postgres.test.ts` prova contexto, configuração, isolamento de conta, papel admin e exclusão real em PostgreSQL. É opt-in via `WACRM_TEMPLATE_DELETE_POSTGRES_TEST=1`, exige `DATABASE_URL` apontando ao alias Docker `wacrm-template-postgres` e ao banco dedicado `wacrm_template_delete_task`, recusa tabelas pré-existentes e remove as tabelas de fixture criadas.
- Validação focada: Vitest da rota e dos três repositórios passou `34/34`; a integração ficou `2/2` skip no run sem Docker. A prova explícita executou `2/2` dentro de Node 22 e PostgreSQL 16, em rede Docker `--internal`, sem porta publicada, sem Supabase e sem saída de rede durante os testes. Container, rede e volume descartáveis foram removidos; contagem final `0/0/0`.
- Seis logs `validation-*.log` mantêm evidências estruturadas e alimentam o painel local `/api/status`, agora com todos os resultados em `PASS` e review desta task pendente.
- `npm run typecheck` passou; ESLint direcionado com `--max-warnings=0` passou sem avisos. Prettier passou para os imports/helper/handler novos por faixa e para os dois testes. O arquivo inteiro da rota já falhava Prettier em `HEAD` (`104` linhas removidas e `116` adicionadas pela formatação completa); GET/PATCH foram preservados fora do escopo. `git diff --check` focado e verificação de whitespace dos arquivos novos passaram; Git emitiu somente aviso de conversão LF/CRLF da configuração local.
- Nenhuma chamada Meta real, banco Supabase, tráfego, VPS ou produção foi usada. Esta task está concluída; H-DATA-003/H-DB-003 globais seguem sem aprovação. Sem commit, push ou deploy.

## Revisão independente

GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas para DELETE /api/whatsapp/templates/[id] somente. Relatório: `.harness/tasks/20261021-003953-b27d/handoffs/reviewer.md`.

## Resultado

Persistência local de DELETE migrou para repositórios PostgreSQL por conta; Auth existente foi preservada. Testes focados 34/34, PostgreSQL 16 descartável 2/2, TypeScript, ESLint direcionado, Prettier focado e `git diff --check` passaram.

## Risco remanescente

Auth/Meta reais, dados/chips reais, tráfego, Supabase, VPS e produção não foram exercitados. Aprovação limita-se ao DELETE desta task.

## Acompanhamento

Prosseguir somente com a fatia PATCH /api/whatsapp/templates/[id] na task 20261021-013249-b008.
