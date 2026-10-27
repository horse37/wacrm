# Prompt — revisão independente Opus 5.5 do working tree WACRM

Faça uma revisão de código independente e somente leitura do working tree atual em `C:\Sistemas\wacrm`, com base no commit `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.

## Estado e protocolo

A task Harness `20261021-113450-6f2c` permanece `in_progress`. O parecer Opus anterior retornou `REMEDIATION_REQUIRED`; as aprovações GPT-6 Luna posteriores são revisões independentes limitadas a fatias e não substituem esta revisão integral.

Antes de avaliar, confirme branch, HEAD e inventário atual do working tree. Inspecione alterações rastreadas e todos os arquivos não rastreados pertinentes, incluindo código, testes, scripts de integração, fixtures, logs/evidências e documentos. O parecer anterior registrava 42 arquivos rastreados modificados, +5.464/−2.786 e 1.428 entradas sujas naquele momento; esses totais são históricos. Recalcule os totais atuais e explique qualquer limite real de cobertura. Não conclua aprovação do working tree se partes relevantes não foram lidas.

Leia `AGENTS.md`, `HANDOFF-CONTEXT.md`, `.harness/current-task.md`, a task e seu handoff em `.harness/tasks/20261021-113450-6f2c/`, o parecer Opus anterior (`review-opus-working-tree-20261021.md` e `.txt`) e os registros de validação/revisão referenciados. Use as aprovações Luna como contexto de escopo, nunca como prova de que o restante está correto.

## Achados anteriores que precisam ser reavaliados

A1 — O parser de reviews perdia verdicts quando APPROVE ou REMEDIATION_REQUIRED aparecia entre crases. Reavalie extração de verdict, contagens de findings/caveats, falsos sucessos em exemplos/código cercado e regressões em `.harness/dashboard-review-progress.mjs` e seus testes.

A2 — O painel em execução servia código antigo e rotulava estado agregado como se fosse resultado de uma fatia. A correção passou a identificar o valor como “Estado agregado da revisão desta task”. O owner panel em `127.0.0.1:49213` foi atualizado: PID 19400; o PID 24904 em `49214` é outra instância preservada. A API e o HTML foram conferidos em HTTP 200/no-store. A revisão independente A2 round 6 aprovou somente esse rótulo e estado ao vivo: `review-a2-independent-20261022-r6.md`.

A3 — O parser de Scope confundia IDs de roadmap H-DATA/H-DB, IDs em negações e descrições livres, e não reconhecia rótulos como “Ressalvas abertas”. Reavalie precedência entre Scope declarado e nome do arquivo, agrupamento por escopo, fallback para task, ordenação de rodadas e cobertura de regressão. A revisão independente A3 round 5 aprovou apenas a correção de IDs de escopo e sua matriz de testes: `review-a3-independent-20261022-r5.md`.

A4 — Task/handoff/context tinham histórico incompleto, próximo passo desatualizado e continuidade apontando para task anterior. Confirme datas, ordem cronológica, marcações SUPERADA, task ativa, próximo passo e limites de aprovação nos registros atuais.

A5 — O parecer anterior questionou se a leitura da credencial do webhook estava bloqueada em código, não apenas na documentação. A rota agora exige `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED === '1'` antes de ler headers/corpo, consultar credencial ou persistir. Reavalie a implementação e os testes fail-closed para variável ausente, vazia e valor diferente de 1. A revisão independente correspondente aprova somente a trava e seus testes.

Reavalie também os demais achados e ressalvas dos pareceres Opus anteriores registrados na task, incluindo segurança do pool PostgreSQL, grants/RLS, identidade de transação, isolamento entre contas, compatibilidade das rotas, fixtures versus migrations versionadas, parser de resultados de validação e confiabilidade do servidor local do painel. Não limite a análise a A1–A5. Procure regressões e riscos materiais adicionais no diff inteiro.

## Critérios de revisão

- Verifique autenticação/autorização, limites entre contas, contexto de tenant, políticas RLS e menor privilégio; não presuma que fixture sintética prova migrations instaláveis.
- Verifique parametrização SQL, transações/rollback, limpeza do contexto de identidade, tratamento de erros e compatibilidade das respostas das rotas.
- Verifique que módulos PostgreSQL server-only não vazem para cliente, e que pool/configuração não aceitem credenciais ou endpoints indevidos.
- Verifique que testes de rota, integração e scripts realmente detectem violações; examine cleanup de recursos e afirmações dos logs.
- Verifique que parser e dashboard nunca convertam evidência ambígua, parcial, antiga ou de escopo diferente em aprovação.
- Verifique se documentação e status distinguem aprovações limitadas, resultado completo do Opus e itens ainda fora de escopo.
- Para cada achado, cite arquivo e linha atuais, cenário concreto, impacto, evidência observada e correção mínima.

## Limites

Esta é revisão somente leitura. Não edite arquivos; não faça commit, push ou deploy; não rode testes, builds, migrations, containers ou bancos; não acesse Supabase, VPS, produção, APIs externas, tráfego WhatsApp/Meta, dados ou credenciais reais. PostgreSQL descartável em Docker Desktop é o único DB permitido no projeto, mas esta revisão não requer iniciá-lo. Não tente habilitar o webhook em ambiente real.

H-DB-003 não está aprovado globalmente. Supabase, Auth, Storage, Realtime, tráfego de aplicação e produção não estão aprovados nem cobertos por aprovações de fatias. Não declare a task Harness inteira nem H-DATA-003/H-DB-003 globalmente aprovados.

## Formato obrigatório da resposta

Comece com Scope, Verdict, Findings e Caveats. Use APPROVE somente se a revisão do working tree completo tiver sido concluída e não houver nenhum achado nem ressalva. Caso contrário, use REMEDIATION_REQUIRED, liste cada item com prioridade, arquivo/linha e evidência, e explique qualquer limite de cobertura. Aprovação, se houver, vale somente para o working tree e o escopo efetivamente revisados.