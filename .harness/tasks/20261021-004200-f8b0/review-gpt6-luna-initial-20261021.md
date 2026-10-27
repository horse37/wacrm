# Primeira revisão independente — GPT-6 Luna

- Task: `20261021-004200-f8b0`, `POST /api/whatsapp/templates/sync`.
- Resultado: `REMEDIATION_REQUIRED`.
- Escopo: somente a rota e os arquivos/evidências indicados; sem aprovação global.

## Achado

- **P2 — SSRF / encaminhamento de bearer token:** `paging.next` era usado diretamente no próximo `fetch`, com o token Meta no cabeçalho `Authorization`. Uma URL para outro host poderia receber o token.
- Correção solicitada: validar HTTPS e origem Graph esperada antes de enviar o bearer.
- Cobertura ausente: rejeição de `paging.next` para origem externa.

## Remediação registrada

A implementação agora exige HTTPS, origem exata `https://graph.facebook.com`, userinfo vazio e caminho `/v21.0/`. URL inválida retorna 502 antes da persistência. Teste cobre host externo, HTTP, userinfo e versão incorreta. Revalidação final: Vitest 46/46, TypeScript, ESLint direcionado, Prettier e `git diff --check` passaram. Segunda revisão independente ainda pendente.
