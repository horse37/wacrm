# Review independente GPT-6 Luna — primeira leitura da rota submit

- Task: `20261021-024500-6a71`, somente `POST /api/whatsapp/templates/submit` e wiring PostgreSQL.
- Resultado: `REMEDIATION_REQUIRED`, um achado P2: a resposta de sucesso montada pela rota omitia `created_at`, `updated_at` e `quality_score`, embora a rota antiga devolvesse o registro persistido completo.
- O revisor confirmou que a persistência existente retornava somente `{ id, action }` e que a fixture de privilégio mínimo não permitia SELECT nessas três colunas. Reconstituir timestamps ou score no handler não preservaria corretamente atualização de linha existente.
- Remediação adotada: extensão documentada de escopo para projeção explícita desses três campos na resposta do repositório, validação dos valores retornados, cobertura de insert/update e grants somente nas fixtures PostgreSQL descartáveis. Não foi criado grant permanente nem alterado schema/RLS/migration.
- A resposta do review não aprova a implementação posterior. Nova revisão read-only é necessária para julgar a remediação e o diff congelado.

O review também recomendou manter o achado aberto em vez de inventar valores caso não fosse autorizada alteração de escopo. A extensão foi limitada à recuperação do contrato legado, sem alterar grants permanentes.
