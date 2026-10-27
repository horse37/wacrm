# Revisão interna read-only — `20261021-032540-24dd`

Data: 2026-10-21, 03:55 BRT
Escopo: somente a migração do lookup `message_templates` em `POST /api/whatsapp/send` e seus testes.
Resultado interno: sem achados nesta fatia. Não representa revisão independente nem aprovação da task inteira.

Checagens:
- A rota removeu o acesso PostgREST específico a `message_templates`; a consulta agora passa pelo repositório server-only.
- O repositório verifica sessão/conta atual e usa SQL parametrizado com conta, nome e idioma.
- Rota preserva idioma `en_US` quando omitido e envia definição validada ao builder; ausência envia `undefined`, preservando fallback.
- Testes verificam `pt_BR`, `en_US`, definição ausente, parâmetros da consulta e ausência de `supabase.from('message_templates')`.
- `sendTemplateMessage` permanece com payload existente; provedor é mockado nos testes.
- Não houve alteração de schema, SQL/repositório, Auth, config WhatsApp ou chamadas reais externas.
- Escopo externo continua pendente: demais leituras/escritas PostgREST, Meta/WhatsApp real, Supabase real, VPS e produção.

Validações técnicas estão em `validation-20261021-0352.log`. Revisão independente GPT-6 Luna ainda necessária.
