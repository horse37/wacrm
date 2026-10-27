# Task — PostgreSQL WhatsApp template PATCH route

- id: `20261021-013249-b008`
- type: `migration`
- slug: `postgres-whatsapp-template-patch-route`
- status: `complete` (somente fatia PATCH; H-DATA-003 continua em andamento)
- roadmap: H-DATA-003, phase 03

## Goal

Migrar somente a persistência local do handler PATCH /api/whatsapp/templates/[id] para repositórios PostgreSQL, preservando Auth e comportamento de edição Meta.

## Context

A fatia DELETE da rota irmã terminou com revisão independente GPT-6 Luna `APPROVE`. O handler PATCH ainda consulta diretamente `profiles`, `message_templates` e `whatsapp_config`. O repositório `template-edit-persistence` e os repositórios de contexto/configuração já existem.

## In scope

- Migrar leituras e gravações locais do PATCH para repositórios PostgreSQL existentes.
- Manter Auth existente; exigir autorização administrativa antes de qualquer efeito Meta, consistente com o contrato do repositório de edição.
- Preservar validação, status permitidos, dry-run, configuração/decrypt, resultados de sucesso/falha Meta e erro genérico de banco.
- Mockar Auth e Meta; adicionar teste PostgreSQL sintético descartável para persistência real, se não houver cobertura de integração.

## Out of scope

- GET/DELETE e rotas submit/sync; alterações de Auth, migrations/schema/RLS/grants; chamada Meta real; Supabase local/remoto como banco; VPS, produção, credenciais/dados/chips reais, tráfego, Storage, Realtime, commit, push ou deploy.
- Aprovação global de H-DATA-003/H-DB-003.

## Validation

- Iniciar com teste RED direcionado da rota.
- Executar testes Vitest de PATCH e dos repositórios alterados; TypeScript; ESLint direcionado com `--max-warnings=0`; Prettier check; `git diff --check`.
- Provar a persistência em PostgreSQL sintético descartável no Docker Desktop, sem Supabase, sem porta pública e com limpeza completa.
- Congelar código/evidências e obter revisão independente GPT-6 Luna read-only até `APPROVE`, zero achados e zero ressalvas.

## Next action

Continuar na próxima fatia estreita H-DATA-003: migrar persistência local de `POST /api/whatsapp/templates/submit` para PostgreSQL usando repositórios existentes. Não interpretar esta conclusão como aprovação global.

## Implementation and validation progress

- PATCH mantém Auth de sessão, remove leituras/gravações locais diretas via Supabase e usa repositórios PostgreSQL de guarda, contexto, configuração e edição. A autorização admin ocorre antes de upload/edição Meta e continua validada na transação de gravação.
- Preservados UUID, JSON, status editáveis, categoria Authentication, configuração/decrypt, dry-run, persistência de erro do provedor, retorno de sucesso e mensagem segura após falha local. Auth e Meta são mockados nos testes.
- Vitest direcionado passou 49/49 em cinco arquivos; TypeScript, ESLint direcionado com --max-warnings=0, Prettier direcionado ao bloco PATCH, Prettier completo nos arquivos novos e git diff --check passaram.
- Integração PostgreSQL 16 descartável passou: leitura/atualização sob RLS forçado, resultados de sucesso e rejeição do provedor, verificação admin e isolamento por conta. Docker Desktop desktop-linux, rede none compartilhada só com runner Node 22, sem portas publicadas; tmpfs e containers removidos. Log da primeira execução aprovada: validation-postgres-template-edit-persistence-022b73c943.log.
- A primeira execução da integração encontrou somente consulta de verificação sem identity GUC; teste ajustado para definir auth.uid() em transação e repetição passou. Log inicial mantido como histórico; recursos foram removidos com contagem 0.
- A revisão independente GPT-6 Luna encontrou um P2: a resposta PATCH usava payload.name e payload.language, embora a persistência mantenha os valores existentes, e deixava de devolver a linha completa do .select().single() anterior. Correção mínima: o UPDATE de sucesso agora retorna colunas explícitas e o handler responde com essa linha persistida; não usa RETURNING \*.
- Regressão cobre payload com nome/idioma diferentes dos armazenados, contrato integral da resposta e conjunto de colunas reais; integração PostgreSQL confirmou nome/idioma autoritativos e retorno dos 22 campos da linha.
- Pós-remediação: Vitest direcionado 49/49; TypeScript; ESLint direcionado com --max-warnings=0; Prettier nos arquivos alterados e no bloco PATCH; git diff --check direcionado; PostgreSQL 16 descartável com RLS forçado. Evidência: validation-template-patch-p2-remediation-20261021.log e validation-postgres-template-edit-persistence-f204f22358.log.
- H-DATA-003/H-DB-003, Auth real, Meta real, Supabase, tráfego, VPS e produção seguem fora do escopo. Sem commit, push ou deploy.

## Review status

- Revisão independente read-only GPT-6 Luna retornou `APPROVE`, zero achados e zero ressalvas, limitada à correção da resposta PATCH e às evidências desta fatia. Registro: `review-gpt6-luna-final-20261021.md`.
- Task slice concluída. H-DATA-003/H-DB-003 globais, Auth real, Supabase, Storage, Realtime, tráfego de aplicação e produção seguem fora da aprovação. Sem commit, push ou deploy.
