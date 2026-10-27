# Revisão interna read-only — inserção de mensagem enviada

- Task: `20261021-054029-8d3a` (`postgres-whatsapp-send-message-insert`), H-DATA-003 fase 03.
- Escopo: somente `INSERT` pós-aceite em `POST /api/whatsapp/send`, repositório, testes e evidências desta fatia.
- Veredito interno: `APPROVE`.
- Achados: zero.
- Ressalvas: zero.
- Revisão independente GPT-6 Luna: pendente.

## Conferências

- A rota chama a persistência somente depois do provedor aceitar o envio. Falha de INSERT mantém HTTP 500 e corpo no mesmo formato; detalhes do banco são convertidos em erro seguro. Sucesso mantém IDs local e do provedor.
- O repositório é server-only, valida UUIDs, usa parâmetros, escopa o INSERT à conversa/conta verificada e seta `auth.uid()` dentro da transação. Conta/conversa sem visibilidade, retorno ausente ou resultado ambíguo falham fechados.
- Nenhuma escrita de `messages` permanece via PostgREST nessa rota; atualização de `conversations` e pausa de `flow_runs` continuam fora do escopo.
- Testes cobrem campos opcionais, resposta a falha após aceite, não persistência quando o provedor rejeita, identidade e caminhos de RLS.
- PostgreSQL 16 descartável provou agente autorizado, viewer negado, isolamento entre contas, campos e FK persistidos, role `NOBYPASSRLS`, RLS forçada e limpeza de identidade; containers removidos.
- Vitest 26/26, TypeScript, ESLint focado, Prettier, sintaxe Node/PowerShell e `git diff --check` passaram.

Sem achados ou ressalvas nesta revisão interna. A conclusão é limitada à fatia descrita; não aprova H-DATA-003/H-DB-003 globalmente, Auth, Supabase, Storage, Realtime, VPS, produção, tráfego real ou outras operações da rota.
