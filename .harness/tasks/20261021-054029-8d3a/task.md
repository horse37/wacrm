# Task — Persistência PostgreSQL da mensagem enviada pelo WhatsApp

- **ID:** `20261021-054029-8d3a`
- **Tipo:** migration
- **Slug:** `postgres-whatsapp-send-message-insert`
- **Estado:** `in_progress`
- **Plano:** H-DATA-003, fase 03

## Objetivo

Migrar somente a inserção do registro de mensagem enviada no fluxo `POST /api/whatsapp/send` do cliente PostgREST para repositório PostgreSQL server-only. Preservar o momento da gravação (após aceite do provedor), o status HTTP e o contrato da resposta.

## Escopo

- Implementar método de repositório server-only com UUIDs validados e SQL parametrizado.
- Restringir inserção à conversa e conta já verificadas; definir `auth.uid()` somente durante a transação e respeitar RLS existente.
- Persistir os mesmos campos e valores atuais, incluindo `reply_to_message_id`; retornar o UUID da linha usado como `message_id` na resposta HTTP.
- Trocar somente o `INSERT` de `messages` nessa rota.
- Testar sucesso, campos nulos/valores opcionais, falha de persistência após envio aceito, identidade errada e isolamento entre contas.
- Validar owner e negação para viewer/conta cruzada em PostgreSQL descartável no Docker Desktop.

## Fora do escopo

Atualização de `conversations`, pausa de `flow_runs`, demais operações PostgREST da rota, mudança de Auth/sessão, schema/migration/policies/grants permanentes, Supabase local/remoto, chamadas Meta/WhatsApp reais, VPS, produção, tráfego, dados/credenciais reais, Storage, Realtime e aprovação global de H-DATA-003/H-DB-003.

## Validação

- Registrar TDD RED antes da alteração de produção.
- Vitest focado para repositório e `POST /api/whatsapp/send`.
- TypeScript, ESLint sem novos avisos, Prettier nos arquivos alterados e `git diff --check`.
- PostgreSQL 16 descartável no Docker Desktop, sem rede externa/portas expostas/dados reais; confirmar owner autorizado, viewer negado, conta cruzada isolada e limpeza da identidade transaction-local.
- Revisão interna read-only e revisão independente GPT-6 Luna; corrigir somente achados desta fatia até `APPROVE`, zero achados e zero ressalvas.

## Limites

Preservar todas as mudanças locais existentes. Sem reset, restore, clean, rebase, troca de branch, commit, push ou deploy. Somente PostgreSQL descartável Docker Desktop; sem Supabase, Meta/WhatsApp real, VPS, produção, tráfego, dados ou credenciais reais. Encerrar a sessão às 09:00 BRT de 2026-10-22 com o ponto de retomada registrado. Task umbrella e H-DATA-003/H-DB-003 não recebem aprovação global.

## Estado da implementação

Implementação concluída; revisões interna e independente aprovadas para esta fatia.

- TDD RED registrado antes da implementação; a primeira execução falhou porque o módulo novo ainda não existia. Log: `tdd-red-message-repository.log`.
- Vitest focado passou 26/26: repositório e rota. Log final: `validation-focused-vitest-final.log`.
- PostgreSQL 16 descartável no Docker Desktop passou com role `NOBYPASSRLS`, RLS forçada, agente autorizado, viewer negado, isolamento entre contas, campos persistidos, FK de resposta e identidade transaction-local limpa; containers removidos. Log: `validation-postgres-message-insert-0695f7f2ef.log`.
- `npx tsc --noEmit`, ESLint focado, Prettier, Node/PowerShell syntax e `git diff --check` passaram. Evidências: `validation-typescript.log`, `validation-eslint.log`, `validation-prettier.log`, `validation-syntax.log` e `validation-diff-check.log`.
- Sem Supabase, Meta/WhatsApp real, VPS, produção, tráfego, dados ou credenciais reais.

## Estado da revisão

Revisões interna e independente read-only GPT-6 Luna retornaram `APPROVE`, zero achados e zero ressalvas, limitadas à inserção de mensagem desta fatia; registros `review-internal-20261021.md` e `review-independent-20261021.md`. H-DATA-003/H-DB-003 seguem sem aprovação global. Próxima fatia: migrar somente a atualização de `conversations` após envio aceito; pausa de `flow_runs` permanece separada.
