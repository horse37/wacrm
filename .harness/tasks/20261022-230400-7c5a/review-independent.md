# Revisão independente GPT-6 Luna — 2026-10-22

## Primeira rodada

**Veredito:** `REMEDIATION_REQUIRED`.

**Achado:** comentário obsoleto em `src/app/api/zap-lead/webhook/route.ts:12-13` afirmava que os recibos do webhook ainda eram persistidos pelo RPC Supabase, embora a fatia os tenha migrado para PostgreSQL. O revisor solicitou descrever o caminho atual e esclarecer que o gate existente não provisiona privilégios runtime `EXECUTE`.

O revisor confirmou que a chamada usa SQL constante e seis parâmetros vinculados, executa dentro de `withTransaction`, preserva os quatro status documentados e converte falhas do banco em erro genérico. O grant temporário foi limitado ao PostgreSQL descartável; migrations não concedem `EXECUTE` a `wacrm_runtime`. O endpoint segue fechado quando a flag existente não é exatamente `1`. A revisão não faz aprovação global de H-DATA-003 ou H-DB-003.

## Correção

O comentário foi atualizado para descrever os caminhos server-only PostgreSQL de consulta de credencial e persistência do recibo e declarar que o gate não provisiona privilégios runtime `EXECUTE` para a função.

## Re-review

**Veredito:** `APPROVE`, zero achados e zero ressalvas para a correção.

O revisor confirmou que o comentário em `src/app/api/zap-lead/webhook/route.ts:12` descreve corretamente os caminhos server-only PostgreSQL e declara que o gate não provisiona privilégios runtime `EXECUTE`. O registro da revisão também preserva corretamente o achado e a correção anteriores.

**Limite:** aprovação cobre somente a correção do comentário; não declara H-DB-003 ou H-DATA-003 prontos/aprovados.
