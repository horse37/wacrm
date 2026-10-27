# Task: Opus review remediation and dashboard reliability

- **ID:** `20261021-113450-6f2c`
- **Type:** fix
- **Status:** in_progress
- **Goal:** Verify and remediate all actionable findings in the supplied Opus review. Obtain a real independent GPT-6 Luna read-only review with `APPROVE`, zero findings, and zero caveats after each finding. Then prepare a new Opus 5.5 review prompt and stop.

## Context

The review covers the working tree from `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`, including work since 2026-10-16. It identifies two grant/migration issues, a creator-profile join compatibility issue, misleading validation status, inaccurate dashboard approval/progress counts, and dashboard-server robustness. It also lists accepted or unverified risks that must remain explicit unless technically resolved within the authorized boundary.

## In scope

1. Eliminate unintended permanent migration/grant changes and prove the shared runtime privilege contract for the webhook, registration, and event-stream readers.
2. Preserve resources created by removed account members and validate expected list/detail behavior.
3. Correct dashboard parsing of mixed Vitest results, task/review state, roadmap identifiers, completed status, full dirty-entry counts, HTML bootstrap substitution, request error handling, and local Host validation.
4. Reconcile dashboard status with the active Harness task and verify the actual page/API refresh.
5. Review previously uninspected code and task artifacts enough to determine whether other actionable findings remain; record unresolved accepted boundaries honestly.

## Out of scope

No Supabase service, VPS, production, real customer data/credentials, or external WhatsApp/Meta traffic. No changes to a persistent database, commit, push, or deploy. Owner explicitly authorized one forward-only migration file for finding 3; validation applies it only to disposable PostgreSQL in Docker Desktop. Do not claim approval of H-DATA-003 or H-DB-003 globally.

## Validation

Run focused tests and static checks for each remediation; use disposable PostgreSQL in Docker Desktop only where database behavior requires it. Run independent GPT-6 Luna read-only review after each finding and repeat until it returns `APPROVE` with zero findings/caveats. Verify dashboard API and served HTML after dashboard fixes. Preserve exact evidence and reviewer output.

## P2-2 — migration boundary and missing role

- Verified `028_zap_lead_webhook_credential_lookup.sql` was a local, untracked migration that created a policy and permanent grants for `wacrm_runtime`, but no project migration created that role. The active handoff prohibits permanent schema/RLS/grant changes.
- Removed that migration. Kept the lookup policy and least-privilege column grants only in this task's disposable PostgreSQL fixture; the validator no longer applies a project migration. `wacrm_runtime` is created only by the disposable fixture.
- PostgreSQL 16 disposable Docker integration passed: `validation-postgres-zap-lead-webhook-credential-read-999231f674.log`. The initial run stopped because the validator referenced the old task's fixture path; fixture was copied into this task and the second run passed.
- Node syntax check, PowerShell parser, and `git diff --check` passed. No application code or permanent migration/grant changed.
- Independent GPT-6 Luna read-only review: `APPROVE`, zero findings and zero caveats, limited to P2-2. Record: `review-p2-2-independent-20261021.md`. The reviewer confirmed the validator relies only on the task fixture and no remaining migration in this lookup path requires `wacrm_runtime`.
- State: P2-2 approved. Next is separate P2-1 review; do not combine approvals across findings.

## P2-1 — shared runtime column privilege

- Because P2-2 removed the only local migration granting/revoking privileges for this lookup, no permanent migration can now revoke `api_base_url` access. Updated the disposable fixture's shared `wacrm_runtime` contract to grant the four columns required across Zap Lead config/credential reads, while continuing to deny table-wide access and unrelated `created_at` access.
- Integration now asserts `api_base_url` is selectable under the key-scoped forced-RLS policy and that unrelated metadata remains denied; the old expectation that `api_base_url` must fail was removed.
- PostgreSQL 16 disposable Docker integration passed: `validation-postgres-zap-lead-webhook-credential-read-eefddf03b8.log`. Prettier check, Node syntax, and `git diff --check` passed. The initial Prettier check flagged the edited file; `prettier --write` was applied and all final checks passed.
- No permanent schema/RLS/grant changes. This fixture defines a test contract only; actual runtime role provisioning remains outside this task under H-DB-003.
- Independent GPT-6 Luna read-only review round 1: `REMEDIATION_REQUIRED`; column privileges are correct, but the test does not exercise registration/event-stream repositories under account-scoped RLS. Record: `review-p2-1-initial-20261021.md`.
- Remediation: fixture now creates `auth.uid()` plus an invoker-only membership predicate, forced account RLS policies for the integration/state rows, and only the columns needed by the shared readers. Integration invokes registration and event-stream repositories using synthetic admin/viewer/cross-account identities and also retains the webhook key-scoped checks.
- Validation after remediation: PostgreSQL 16 disposable Docker passed in `validation-postgres-zap-lead-webhook-credential-read-c642caf39d.log`; Prettier check, Node syntax, ESLint `--max-warnings=0`, and `git diff --check` passed.
- Independent GPT-6 Luna read-only re-review: `APPROVE`, zero findings, zero caveats, limited to P2-1. Reviewer confirmed the account-based RLS visibility gap is closed and exercised under `wacrm_runtime`.
- Review record: `review-p2-1-independent-20261021.md`.
- State: P2-1 approved. Next is P2-3; keep findings separate and do not begin P2-4 before P2-3 receives its own zero-finding approval.

## P2-3 — preserve account-owned resources after member removal

- Finding: migration 018 moves a removed member's `profiles.account_id` to a new personal account while their account-owned rows retain the original `account_id`. `INNER JOIN`/`EXISTS` checks against the mutable creator profile therefore hid rows from the original account.
- Remediation: account-scoped repositories now authorize and select resources by the resource row's verified `account_id` plus the existing account guard/RLS. Removed creator-profile joins from account-scoped automation, flow/run, broadcast, pipeline/deal, approved-template, template lifecycle/send/sync, and message-reaction reads/writes. Pipeline DTO checks now compare durable resource account IDs directly.
- User-owned operations retain profile checks only when SQL also binds `user_id` to the verified caller (automation editor/duplicate, user template editor/manager/inbox/submission); flow creation still verifies the current creator identity. No account-wide list/detail query relies on the creator's current profile membership.
- Disposable PostgreSQL integrations passed with a synthetic former member whose profile is in a personal account while the pipeline, flow, and automation remain in the original account. Original-account viewers can still read those rows; a different account cannot. Evidence: `.harness/tasks/20261020-002315-05e4/validation-postgres-pipeline-list-cb9de9bc40.log`, `.harness/tasks/20261020-015908-49b2/validation-postgres-flow-list-647441874a.log`, and `.harness/tasks/20261020-013807-d36c/validation-postgres-automation-log-list-7304033a46.log`.
- Repository Vitest suite passed 729 tests, 2 skipped (76 files); `npx tsc --noEmit`, targeted ESLint `--max-warnings=0`, Prettier check for changed sources/tests/integration scripts, and `git diff --check` passed.
- Independent GPT-6 Luna read-only review: `APPROVE`, zero findings, zero code caveats, limited to P2-3. Reviewer confirmed account-scoped reads/writes retain verified account guard/RLS; remaining profile joins are caller-bound or same-account assignee checks; no account-wide query depends on the creator's current profile membership. Review record: `review-p2-3-independent-20261021.md`.
- State: P2-3 approved. Next is P2-4, the mixed Vitest log result parser. Keep findings separate; do not begin P3-1 before P2-4 receives its own zero-finding approval.

## P2-4 — classify mixed Vitest logs as failure

- Finding: the dashboard recognized `FAIL:` but Vitest emits `FAIL  path`; the fallback `passed` substring could label a mixed failed/passed log as successful.
- Remediation: `.harness/dashboard-validation-result.mjs` now classifies explicit failure lines and Vitest failure summaries before any success signal, strips ANSI color codes, and requires explicit success evidence instead of incidental `passed` text. `.harness/dashboard-validation-result.test.mjs` covers mixed results, ANSI output, incidental text, explicit success, and failure precedence.
- Validation: regression tests 5/5; Node syntax checks, focused Prettier check, and `git diff --check` passed. Evidence: `validation-p2-4-dashboard-result.log`. An initial Prettier check failed and was superseded by formatting plus the passing final check.
- Independent GPT-6 Luna read-only review: `APPROVE`, zero findings, zero caveats, limited to P2-4. Record: `review-p2-4-independent-20261021.md`. The historical mixed log named in the original review was rechecked and classifies `FAIL`.
- State: P2-4 approved. Next is P3-1 dashboard review/task-state counts; keep P3-2 separate.

## P3-1 — accurate dashboard review and task-state counts

- Finding: any historical review file containing APPROVE could mark a task approved despite a later remediation review; final approval text citing an earlier remediation was rejected. Backticked roadmap IDs were missed, `complete` was untranslated, and `--untracked-files=normal` collapsed untracked directories.
- Remediation: latest review file by modification time now determines each task's current review result. Final explicit approvals are evaluated by their stated zero-finding/zero-caveat counts, without rejecting a final approval merely because it mentions an earlier remediation. Dashboard wording distinguishes latest slice review decisions from completed Harness tasks. Roadmap parsing accepts backticks; `complete` and `completed` map to `Concluída`; Git status counts all untracked files.
- Validation: dashboard unit checks passed 10/10; Node syntax, focused Prettier, and focused `git diff --check` passed. Inventory check returned 1400 entries with `--untracked-files=all` versus 392 with `--untracked-files=normal`. Across 42 reviewed H-DATA-003 task directories, 31 latest reviews approve and 4 tasks are completed with latest approval. The cited 212612 task remains `in_progress` and is not counted as completed. Evidence: `validation-p3-1-dashboard-review-progress.log`.
- Independent GPT-6 Luna read-only review: `APPROVE`, zero findings, zero caveats, limited to P3-1. Record: `review-p3-1-independent-20261021.md`.
- State: P3-1 approved. **SUPERADA:** P3-2 dashboard HTTP safety/live refresh was later completed and approved in round 2; the subsequent Opus review opened A1–A5 and the webhook caveat, now current.

## P3-2 — dashboard HTTP safety, errors, and live refresh

- The dashboard rejects non-loopback `Host` values, substitutes bootstrap JSON through a replacement callback, catches request and periodic-refresh errors, and returns HTTP 500 JSON when status persistence fails.
- The page fetches `/api/status` without cache on load and every 20 minutes. The HTTP integration now verifies a fresh `checkedAt` timestamp, `Cache-Control: no-store`, the page polling contract, hostile-host rejection, and persistence-failure handling.
- Focused tests passed 3/3; Node syntax, focused Prettier check, and `git diff --check` passed. Evidence: `validation-p3-2-dashboard-http-20261021.log`.
- Independent GPT-6 Luna read-only review round 1 returned `REMEDIATION_REQUIRED`: the tests cover a new temporary server but do not prove the active panel stopped serving its older process. Record: `review-p3-2-independent-20261021-r1.md`.
- Remediation after review round 1: the owner restarted the panel; listener PID 9980 replaced PID 14696. Live `GET /dashboard.html` returned HTTP 200 with the bootstrap substituted, no-cache `/api/status` fetch, and 20-minute polling. The live API returned fresh status, expected `main`/HEAD and task, and 1407 dirty entries matching Git. Evidence: `validation-p3-2-dashboard-http-20261021.log`.
- Independent GPT-6 Luna read-only re-review round 2 returned `APPROVE`, zero findings, and zero caveats, limited to P3-2. Record: `review-p3-2-independent-20261021-r2.md`. The round 1 live-process finding is resolved.
- State: all six actionable findings from the supplied review have separate Luna approvals. The Harness task remains `in_progress`; no task-wide or H-DATA-003/H-DB-003 approval is claimed. SUPERADA em 2026-10-21 pelo parecer Opus posterior: esse snapshot dizia que os seis achados estavam aprovados e pedia prompt; o parecer seguinte abriu A1–A5 e a ressalva do webhook.

## Review Opus round 2 — achado 1 (P2), bloqueio H-DB-003

- Achado: a leitura da credencial do webhook depende de policy/grants presentes somente na fixture, não nas migrations versionadas; sem policy, RLS pode transformar chave válida em resposta 401.
- Correção documental: bloqueio explícito de ativação registrado em `.harness/tasks/20261021-090800-c1f7/task.md`, `handoffs/implementer.md`, `.harness/current-task.md` e `HANDOFF-CONTEXT.md`. A rota não pode ser habilitada/implantada no runtime PostgreSQL até H-DB-003 provisionar o papel, grants mínimos e policy compatível.
- Nenhuma migration, grant, policy permanente, Supabase, tráfego real ou deploy foi usado. Este item aguarda review independente GPT-6 Luna read-only; nenhuma aprovação é presumida.
- Review Luna do achado 1, rodada 2: `APPROVE`, zero achados/ressalvas, somente para o bloqueio documental H-DB-003. Registro: `review-luna-hdb003-blocker-r2.md`. Nenhuma ativação da rota ou prontidão operacional foi aprovada.

## Review Opus round 2 — achado 2 (P3), limites da fixture e cobertura PostgreSQL

- Divergências agora listadas em comentário da fixture, task e handoff: migrations 024/025 usam `TO authenticated` enquanto a fixture usa `wacrm_runtime`; migration 017 usa `SECURITY DEFINER` para `is_account_member` e fixture usa `SECURITY INVOKER`; fixture inclui policy `profiles_select` e grant runtime-only. Prova continua sendo contrato sintético, não replay nem paridade da cadeia de migrations; compatibilidade instalável segue bloqueada para H-DB-003.
- Cobertura adicionada ao integrador: cursor do event-stream com key de outra conta; RLS direta da tabela de estado contra outra conta; leitura de integração e heartbeat da registration com conta divergente; limpeza dos GUCs `app.wacrm_zap_lead_webhook_key_id` e `request.jwt.claim.sub` consultada na mesma conexão física depois do commit.
- Validação Docker/PostgreSQL 16 e revisão Luna deste achado ainda pendentes; nenhum resultado presumido.
- Validação final do achado 2: integrador PostgreSQL 16 descartável SUCCESS em `validation-postgres-zap-lead-webhook-credential-read-e5cd5eb3d7.log`; Node syntax, Prettier check final e `git diff --check` passaram; container/rede temporários removidos. Primeira checagem Prettier sinalizou formato e foi corrigida antes da validação final. Aguardando review Luna independente.
- Review Luna do achado 2: `APPROVE`, zero achados/ressalvas, limitado à documentação das divergências da fixture e cobertura adicional do integrador. Registro: `review-luna-fixture-contract.md`. Aprovação não valida paridade com migrations nem readiness operacional.

## Rechecagem independente P2-4 — 2026-10-21

- GPT-6 Luna independente reavaliou os casos apontados pelo Opus: `Result: FAIL`/`FAILURE` prevalece sobre sinais de sucesso; `Errors N error(s)` com N maior que zero falha; `Errors 0` não bloqueia resumo aprovado. Veredicto real: `APPROVE`, zero achados e ressalvas. Registro exato: `review-p2-4-independent-20261021-r2.md`. Escopo somente P2-4.
- Testes focados do parser e agregador do dashboard passaram 24/24. `git diff --check` retornou código 0; avisos exibidos foram somente conversões LF/CRLF do Git.
- Os seis achados originais e os dois achados do follow-up Opus têm revisões Luna separadas com `APPROVE`, sem aprovação da task inteira ou de H-DATA-003/H-DB-003.
- SUPERADA em 2026-10-21 pelo parecer Opus posterior: não preparar o novo prompt até resolver A1–A5 e a ressalva do webhook.

## P3-1 round 6 finding and round 7 re-review — 2026-10-21

- Independent GPT-6 Luna round 6 returned `REMEDIATION_REQUIRED`, P3-1 only. It found that `explicitVerdict()` treated a standalone `Result: FAIL` in a plain example or code block as a conflicting review verdict after `Verdict: APPROVE`. Record: `review-p3-1-independent-20261021-r6.md`.
- Remediation: verdict parsing strips inline code, ignores fenced code blocks, and ignores labeled example-output blocks through their paragraph boundary. Regression cases cover plain examples with/without a blank after the label, fenced code, a genuine conflicting `Result: FAIL`, and a genuine failure following an example boundary.
- TDD validation: focused test failed before implementation (21/22 passed), then passed 22/22. Node syntax checks, focused Prettier check, and `git diff --check` exited 0. Evidence: `validation-p3-1-verdict-examples-r7.log`.
- **SUPERADA após a round 7:** o próximo passo histórico era pedir a revisão independente da round 7. A rodada ocorreu e encontrou novo achado; a sequência foi seguida até a aprovação da round 9. A1–A5 e a ressalva do webhook são o escopo atual.

## P3-1 round 7 finding and round 8 re-review — 2026-10-21

- Independent GPT-6 Luna round 7 returned `REMEDIATION_REQUIRED`, P3-1 only. It found that the round 7 implementation filtered examples for verdict parsing but still checked `Findings:` and `Caveats:` counts against the original unfiltered text. Example counts could incorrectly change approval classification. Record: `review-p3-1-independent-20261021-r7.md`.
- Remediation: moved fenced-code, inline-code, and labeled example filtering into `reviewTextWithoutExamples()` and use its result for both explicit verdict and zero-finding/zero-caveat checks. Added regression cases for positive finding/caveat counts in examples/code and a genuine positive finding after the example boundary.
- TDD validation: focused test failed before implementation (23/24 passed), then passed 24/24. Node syntax, focused Prettier, and `git diff --check` passed. Evidence: `validation-p3-1-verdict-and-count-examples-r8.log`.
- **SUPERADA após a round 8:** o próximo passo histórico era pedir a revisão independente da round 8. A rodada ocorreu e encontrou novo achado; a sequência foi seguida até a aprovação da round 9. Não há aprovação global.

## P3-1 round 8 finding and round 9 re-review — 2026-10-21

- Independent GPT-6 Luna round 8 returned `REMEDIATION_REQUIRED`, P3-1 only. It found that four-space/tab-indented Markdown code lines were still included in verdict and finding/caveat parsing. Record: `review-p3-1-independent-20261021-r8.md`.
- Remediation: `reviewTextWithoutExamples()` now drops lines belonging to Markdown indented code blocks in addition to fenced/inline code and labeled examples. Regression cases cover four-space and tab-indented `Result: FAIL`, `Findings: 1`, and `Caveats: 1`; real conflicts and positive counts after example boundaries remain checked.
- TDD validation: focused test failed before implementation (22/24 passed), then passed 24/24. Node syntax, focused Prettier, and `git diff --check` passed. Evidence: `validation-p3-1-indented-code-r9.log`.
- **SUPERADA após a round 9:** o próximo passo histórico era pedir a revisão independente da round 9; ela retornou `APPROVE`, zero achados e zero ressalvas. A revisão Opus posterior abriu A1–A5 e a ressalva do webhook, que seguem como escopo atual.

## Internal read-only check and Opus review handoff — 2026-10-21

- Internal review of the remediated finding scopes and current evidence found no remaining actionable item within the stated task scope. The latest actual independent records are: P2-1 `review-p2-1-independent-20261021.md`; P2-2 `review-p2-2-independent-20261021.md`; P2-3 clarification `review-p2-3-independent-20261021-r2-clarification.md`; P2-4 `review-p2-4-independent-20261021-r2.md`; P3-1 `review-p3-1-independent-20261021-r9.md`; P3-2 `review-p3-2-independent-20261021-r2.md`; Opus follow-up finding 1 `review-luna-hdb003-blocker-r2.md`; and finding 2 `review-luna-fixture-contract.md`. Each approval is limited to its recorded finding/slice and reports zero findings and zero caveats.
- Latest P3-1 rounds 6–8 each returned actual `REMEDIATION_REQUIRED`; all were corrected and round 9 returned `APPROVE`, zero findings and caveats. No approval was inferred from earlier rounds.
- The previous P3-1 validation/API snapshot is superseded. After the Opus report, the dashboard was restarted and its fresh API returned task `20261021-113450-6f2c` / `in_progress`, current review `REMEDIATION_REQUIRED`, expected `main`/HEAD, and 1434 dirty entries matching Git. Served HTML/API returned `no-store`, active-task bootstrap, no-cache fetch and 20-minute refresh. Evidence: `validation-a2-dashboard-live-20261021.log`. Review aggregation totals remain subject to A3.
- This handoff state was superseded by the later Opus review attached on 2026-10-21. Do not use this as the current next action.

## Opus follow-up A1 — inline-code verdict parsing

- The latest Opus review found that the dashboard parser removed inline-code values from review fields, so real `Verdict: `APPROVE`` and `Result: `REMEDIATION_REQUIRED`` records became pending. The exact supplied review is preserved separately in this task directory.
- `reviewTextWithoutExamples()` now preserves inline-code contents only on recognized verdict/count field lines while continuing to remove inline code from prose. Regression coverage includes approval, remediation, zero counts, Portuguese verdicts, and inline-code examples in prose.
- TDD red reproduced the original `pendente` result. Post-fix focused tests passed 25/25; Node syntax, Prettier check, and `git diff --check` passed. Evidence: `validation-p3-1-a1-20261021.log`.
- Independent GPT-6 Luna A1 review round 1 returned `REMEDIATION_REQUIRED` only because ignored/untracked files prevented Git from exposing a baseline. Round 2 approved the logic but cited static-only review as a caveat. Round 3 returned actual `APPROVE`, zero findings and zero open caveats after considering the exact before/after delta and validation evidence. Exact outputs: `review-p3-1-a1-independent-r1.md`, `review-p3-1-a1-independent-r2.md`, and `review-p3-1-a1-independent-r3.md`.
- State: A1 approved, limited to inline-code review-field parsing. A2 restart instruction is superseded; rounds 1–4 returned `REMEDIATION_REQUIRED` for stale records. Round 3 parser metadata was added without changing original reviews; round 4 stale Opus next-action statements were marked superseded, and dashboard nextAction was shortened. A2 remains open pending round 5. A3–A5 and the webhook code-level blocker remain open. Do not claim task-wide or global H-DATA-003/H-DB-003 approval.

## Opus follow-up A2 — live dashboard refresh

- Restarted only the verified dashboard process: old PID 9980 was replaced by PID 26768 after the parser fix. Fresh API and served-page checks are recorded in `validation-a2-dashboard-live-20261021.log`.
- The API now reports the correct active task/status and review `REMEDIATION_REQUIRED`; 1434 dirty entries match Git. The live page and API return `Cache-Control: no-store`; page contains the task bootstrap, no-cache status fetch, and 20-minute polling.
- A2 live verification is recorded, but independent GPT-6 Luna round 1 returned `REMEDIATION_REQUIRED` for two documentation inconsistencies. A2 is not approved.

### A2 — resultado da revisão independente round 1

- Saída independente GPT-6 Luna preservada integralmente em `review-a2-independent-20261021-r1.md`: `REMEDIATION_REQUIRED`, limitada a A2.
- Revisor confirmou PID 26768, API/página atualizadas e contagem observada; pediu explicitar onde fica `server.json` e marcar como superada a instrução antiga de reiniciar o painel no handoff.
- O arquivo fica fora do repositório: `%LOCALAPPDATA%\Wacrm\migration-dashboard\server.json` (resolvido nesta máquina como `C:\Users\Dell\AppData\Local\Wacrm\migration-dashboard\server.json`). `status.json` fica no mesmo diretório.
- Estado histórico: as duas correções documentais foram aplicadas; a revisão r2 encontrou referências de andamento obsoletas. Ver a seção da round 2.

### A2 — resultado da revisão independente round 2

- GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`. Saída integral: `review-a2-independent-20261021-r2.md`.
- A revisão confirmou o caminho externo de `server.json` e o PID 26768; apontou uma instrução ativa obsoleta na linha de estado A1 de `task.md` e `nextAction` do painel ainda pedindo as correções já realizadas.
- Estado histórico: registros de andamento foram corrigidos e `nextAction` já apontava para a revisão round 3; essa revisão encontrou `currentReview` como `pendente` porque os pareceres A2 não tinham campos legíveis pelo agregador.

### A2 — resultado da revisão independente round 3

- GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`. Saída integral: `review-a2-independent-20261021-r3.md`.
- Documentação da localização de `server.json`, PID 26768 e próxima ação do painel foram confirmados. O achado restante foi a API mostrar `currentReview: pendente` enquanto os pareceres A2 diziam `REMEDIATION_REQUIRED`.
- Causa: os registros preservavam a resposta real em formato livre; o agregador existente exige os campos `Scope:` e `Verdict:` para classificá-los. A resposta original permanece intacta; foram anexados campos de indexação explícitos, identificados como metadados derivados e não como texto do revisor.
- Estado histórico: API confirmou `currentReview: REMEDIATION_REQUIRED` e nextAction de round 4; a revisão r4 apontou instruções Opus antigas no handoff e dificuldade de leitura do nextAction longo.

### A2 — resultado da revisão independente round 4

- GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`. Saída integral: `review-a2-independent-20261021-r4.md`.
- `currentReview` e `currentTaskReview` agora refletem `REMEDIATION_REQUIRED`; `server.json`/PID 26768 conferidos. O revisor apontou duas frases de handoff ainda anunciando o Opus como próxima ação e não conseguiu ler nextAction no retorno comprimido.
- Frases antigas estão marcadas `SUPERADA`; validação final confirmou API 200/no-store, status `in_progress`, `currentReview=REMEDIATION_REQUIRED`, nextAction curto de 132 caracteres para r5 e dirtyEntries 1439 igual ao Git. Branch `main` e HEAD esperado; `git diff --check` sem erros.
- Estado histórico SUPERADO pela revisão Luna A2 round 5: A2 foi aprovada; a próxima ação passa a ser A3.

### A2 — revisão independente round 5 — 2026-10-21

- Saída real e integral preservada em `review-a2-independent-20261021-r5.md`: GPT-6 Luna retornou `APPROVE`, zero achados e zero ressalvas, limitada a A2.
- O revisor confirmou API ao vivo com task `in_progress`, `currentReview` e `currentTaskReview` em `REMEDIATION_REQUIRED`, `nextAction` legível para round 5 mantendo A3 bloqueada, PID 26768, HTML servido e metadados derivados identificados.
- A2 aprovada somente para reinício do painel e atualização da API/HTML. Isso não aprova a task inteira nem H-DATA-003/H-DB-003.
- SUPERADA: a próxima ação passou a ser A3 (agrupamento de escopos); o resultado A3 está registrado abaixo.

## A3 — agrupamento de escopos — revisão independente round 1

- A correção remove disclaimers de negação/exclusão antes de extrair IDs do campo `Scope:`, normaliza o texto restante e mantém o fallback por task para scopes só com disclaimer. Os testes preservam IDs positivos e referências a achados Opus e cobrem texto livre com disclaimer e disclaimer-only.
- Validação repetida: `node --test .harness/dashboard-review-progress.test.mjs` passou 27/27; `node --check` e Prettier passaram. Evidência: `validation-a3-scope-20261021.log`.
- GPT-6 Luna independente round 1 retornou `APPROVE`, zero achados e uma ressalva. A resposta e metadados estão em `review-a3-independent-20261021-r1.md`. **SUPERADA pela round 2:** a ressalva era a verificação do painel ao vivo.
- **SUPERADA pela round 2:** a observação anterior identificou PID 26768 na porta 49213 e pediu reinício pelo dono. O dono iniciou o servidor atualizado em `49214`; a aba 14 e a API desse endereço foram verificadas e a nova revisão independente aprovou A3 sem ressalvas.
- A4, A5 e a ressalva do webhook permanecem abertas. A task continua `in_progress`; nenhuma aprovação da task inteira ou de H-DATA-003/H-DB-003 é declarada.

## A3 — revisão independente round 2 — 2026-10-21

- Resultado real GPT-6 Luna: `APPROVE`, zero achados e zero ressalvas, limitado a A3. Resposta final exata: `review-a3-independent-20261021-r2.md`.
- A revisão confirmou a aba 14 em `http://127.0.0.1:49214/dashboard.html`; a página renderiza task e estado do repositório atuais, e `GET /api/status` no mesmo host confirma task `20261021-113450-6f2c`, `in_progress`, branch `main` e HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`. A menção a PID 26768 é texto persistido de próxima ação antiga; não indica que a aba usa o servidor antigo.
- A3 está aprovada apenas quanto ao agrupamento de escopos. A4, A5 e a ressalva do webhook seguem abertas; a task permanece `in_progress` e H-DATA-003/H-DB-003 não têm aprovação global.

## A4 — histórico de reviews e continuidade — rounds 1–5

- O histórico P3-1 agora lista as rodadas omitidas em ordem cronológica: round 2 (`REMEDIATION_REQUIRED`, associação de múltiplos achados), round 3 (`REMEDIATION_REQUIRED`, contagens contraditórias), round 4 (`REMEDIATION_REQUIRED`, vereditos finais conflitantes) e round 5 (`APPROVE`, zero achados/ressalvas). Os registros correspondentes são citados sem afirmar que sejam saídas integrais; a proveniência será tratada em A5.
- As afirmações antigas de que todos os achados estavam aprovados e de que o próximo passo era preparar o prompt Opus permanecem explicitamente `SUPERADA` pela revisão Opus posterior, que abriu A1–A5 e a ressalva do webhook.
- `HANDOFF-CONTEXT.md` agora aponta a task ativa `20261021-113450-6f2c`, registra A3 aprovada, A4 como próxima revisão pendente e preserva as restrições. O prompt de continuação também foi atualizado; blocos antigos ficam históricos.
- `git diff --check` direcionado aos documentos alterados passou; o registro da resposta A3 também passou `prettier --check`. O status/API do painel confirma task `in_progress`, branch `main`, HEAD esperado e 1443 entradas locais.
- **SUPERADA pela round 1:** A4 aguardava revisão independente. A rodada retornou `REMEDIATION_REQUIRED`, 2 achados e 0 ressalvas; resposta em `review-a4-independent-20261021-r1.md`.
- Achado 1: handoff ainda mantinha a próxima ação antiga de implementar A4; marcada `SUPERADA`.
- Achado 2: `HANDOFF-CONTEXT.md` ainda direcionava `Read first` à task anterior; atualizar a lista para os arquivos ativos.
- **SUPERADA pela round 2:** os dois conflitos da round 1 foram corrigidos e o diff-check passou; a re-review ocorreu e encontrou uma instrução de continuidade ainda obsoleta.
- **A4 round 2 — REMEDIATION_REQUIRED, 1 achado, 0 ressalvas.** Resposta independente preservada em `review-a4-independent-20261021-r2.md`.
- Achado: quatro registros ainda diziam para corrigir os conflitos da round 1, já resolvidos: `.harness/current-task.md`, este `task.md`, `handoffs/implementer.md` e o prompt em `HANDOFF-CONTEXT.md`.
- **SUPERADA após a round 2:** alinhar os quatro registros obsoletos e validar diff documental; os textos foram atualizados e `git diff --check` passou.
- **SUPERADA após a round 3:** solicitar review r3 após diff-check; revisão ocorreu e encontrou uma frase que atribuía os achados r1 ao review atual.
- **A4 round 3 — REMEDIATION_REQUIRED, 1 achado, 0 ressalvas.** Resposta independente preservada em `review-a4-independent-20261021-r3.md`.
- Achado: `HANDOFF-CONTEXT.md` descrevia dois conflitos como resultado do review atual, embora fossem os dois achados históricos da round 1 e a round 2 tivesse um achado distinto.
- **SUPERADA após a round 4:** marcar os dois conflitos como achados históricos da r1, validar e solicitar review r4; as ações foram concluídas.
- **A4 round 4 — REMEDIATION_REQUIRED, 1 achado, 0 ressalvas.** Resposta independente preservada em `review-a4-independent-20261021-r4.md`.
- Achado: os quatro registros ainda instruíam a corrigir a frase histórica e pedir a round 4, embora ambas as ações já estivessem concluídas.
- **SUPERADA após a round 4:** registrar o resultado e alinhar os próximos passos; alterações concluídas e diff-check focado passou.
- **SUPERADA pela round 5:** solicitar revisão independente da A4; a revisão foi concluída e aprovada.
- A4 está aprovada somente no escopo documental/continuidade; a task inteira e H-DATA-003/H-DB-003 seguem sem aprovação global.

## A4 — revisão independente round 5 — 2026-10-21

- GPT-6 Luna independente read-only retornou APPROVE, 0 achados e 0 ressalvas para a reconciliação documental e continuidade da A4. Resposta e esclarecimento exatos: review-a4-independent-20261021-r5.md.
- Validação da documentação A4: git diff --check direcionado passou; o novo registro r5 passou Prettier --check e verificação de whitespace. Nenhum teste, build ou Docker necessário para essa revisão documental.
- A resposta inicial continha frase ambígua sobre a aprovação; o revisor esclareceu que a A4 revisada está aprovada e que somente a task Harness inteira e H-DATA-003/H-DB-003 seguem sem aprovação global. Ambos os textos estão preservados no registro.
- Próxima ação: corrigir proveniência dos registros de review (A5), depois tratar a ressalva de fail-closed do webhook, uma por vez e com nova revisão independente.

## A5 — proveniência dos pareceres — auditoria inicial pré-review

- Pré-review: índice cobria 36 pareceres persistidos, auditoria 36/36 sem divergências; A5 r1 foi então incluída e o índice atualizado para 37 registros.
- Corrigida a origem formal das rodadas A4: r1 é 01a160af-ddca-7171-859a-0c327008b1ce; r2 é 01a160b9-fad1-7ce1-9ac8-f24d9fa9cb12; r3–r5 seguem os respectivos threads. O thread preliminar 01a160a8-1f63-7741-aab7-b9851a738dce não tem resposta integral preservada; a revisão A5 r1 consultou a fonte e confirmou diretamente REMEDIATION_REQUIRED, 3 achados e 0 ressalvas. Ele não entra nas rodadas formais r1–r5.
- A resposta exata recuperável da clarificação P2-3 foi anexada ao registro; A4 r5 recebeu metadados derivados e origem identificada.
- Evidência: `validation-a5-provenance-20261021.log`; testes focados 30/30, Prettier e `git diff --check` passaram, API/página do painel retornaram 200/no-store com task/HEAD esperados.
- Estado pré-review SUPERADO pela round 1: a revisão independente A5 ocorreu; ver seção de remediação abaixo.

## A5 — revisão independente round 1 e remediação

- GPT-6 Luna independente retornou REMEDIATION_REQUIRED, 2 achados e 1 ressalva; resposta exata em review-a5-independent-20261021-r1.md. A próxima ação era solicitar re-review A5 r2; esse estado foi SUPERADO pela resposta r2 abaixo.
- Achado 1: nota antiga dizia incorretamente que os threads P3-1 r4/r5 não tinham IDs dedicados. Corrigida para registrar que ambos estão mapeados na tabela.
- Achado 2: a síntese ao fim de A4 r5 não identificava autoria derivada. O título agora declara “Síntese do implementador” e “não verbatim”.
- Ressalva: registros A3 r1/r2, H-DB-003 blocker r1/r2 e P3-1 A1 r1–r3 compartilhavam thread ID. O índice agora identifica thread, turno e mensagem final exatos para cada resposta.
- A revisão A5 r1 consultou diretamente o thread preliminar A4 e confirmou REMEDIATION_REQUIRED, 3 achados e 0 ressalvas. O parecer integral não foi recuperado nem é apresentado como verbatim.
- Validação focada: auditoria confirma 37/37 registros/linhas e respostas em threads compartilhados desambiguadas por turno/mensagem. Prettier passa no índice e nos registros A4/A5; as seções novas de task/handoff passam Prettier em fragmento; cinco arquivos sem trailing whitespace; git diff --check PASS. Evidência: validation-a5-remediation-r1-20261021.log.
- Painel atualizado: API e página retornam 200/no-store; task in_progress, review REMEDIATION_REQUIRED, branch main, HEAD esperado e 1452 entradas dirty. Sem PostgreSQL/Docker: alterações desta rodada são documentais.

## A5 — revisão independente round 2 e remediação

- GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`, 1 achado e 0 ressalvas. Resposta exata: `review-a5-independent-20261021-r2.md`.
- Achado: o thread compartilhado A3 contém duas respostas finais adicionais, ambas `REMEDIATION_REQUIRED`, 0 achados e 1 ressalva, ausentes do índice e do histórico da task.
- Remediação: o índice agora registra ambas separadamente como respostas finais intermediárias não persistidas, com os IDs exatos de thread, turno e mensagem. Mantém distinto o total de 38 arquivos de review persistidos; não inventa nem apresenta como verbatim os corpos de resposta ausentes. A3 r1/r2 formais continuam mapeadas sem alteração.
- Validação focada da documentação e do painel registrada em `validation-a5-remediation-r2-20261021.log`; nenhum código, PostgreSQL ou Docker foi alterado nesta rodada.
- A5 permanece aberta e a task `in_progress`. Próxima ação: pedir review independente GPT-6 Luna read-only A5 round 3, limitada à proveniência corrigida.

## A5 — revisão independente round 3 — aprovada

- GPT-6 Luna independente retornou APPROVE, 0 achados e 0 ressalvas, limitado à proveniência A5. Resposta exata: review-a5-independent-20261021-r3.md.
- O revisor confirmou IDs exatos das duas respostas A3 não persistidas, metadados REMEDIATION_REQUIRED/0 achados/1 ressalva para ambas, e paridade do inventário A5 à época da revisão: 38/38. Depois de preservar também o registro r3, o índice atual contém 39/39 arquivos de review persistidos; as duas respostas A3 seguem fora dessa contagem.
- A5 está aprovada somente para proveniência. A task continua in_progress; a ressalva fail-closed do webhook, H-DATA-003 e H-DB-003 permanecem sem aprovação global.
- Próxima ação: tratar a ressalva fail-closed do webhook da revisão Opus, em fatia separada e sem alteração permanente de schema/RLS/grants.
- Evidência r3: validation-a5-remediation-r3-20261021.log.

## Ressalva Opus — bloqueio fail-closed do webhook

- A rota POST /api/zap-lead/webhook agora exige WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED=1 antes de ler o corpo, consultar credenciais ou gravar recibos. Valor ausente ou diferente de 1 retorna HTTP 503 genérico; nenhuma consulta ao repositório de credenciais nem gravação de evento ocorre.
- Teste de regressão primeiro falhou como esperado: o caminho desabilitado ainda retornava 200. Após a trava, o teste da rota passou 18/18.
- TypeScript, ESLint direcionado com zero avisos, Prettier dos dois arquivos e git diff --check passaram. Evidência: validation-webhook-fail-closed-r1-20261021.log.
- Alteração só de rota e teste; sem migration, mudança de schema/RLS/grants, PostgreSQL ou Docker. A variável não foi ativada em ambiente real.
- **SUPERADA:** a revisão independente round 1 ocorreu; seu resultado e a remediação estão registrados abaixo.

## Ressalva Opus — revisão independente round 1 e remediação

- GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`, limitado à trava do webhook e seu teste. A rota já bloqueava antes da leitura de headers, corpo, credenciais ou persistência; o teste cobria somente valor vazio e não provava que o corpo permanecia sem leitura. Parecer exato: `review-webhook-fail-closed-independent-20261021-r1.md`.
- O teste agora cobre variável ausente, vazia e valor diferente de `1` (`true`). Cada caso usa um leitor de corpo que falha se acessado e confirma que ele, a consulta de credencial e a persistência não são chamados.
- Validação pós-correção passou: Vitest 20/20, TypeScript, ESLint direcionado com zero avisos, Prettier e `git diff --check`. Evidência: `validation-webhook-fail-closed-r2-20261021.log`.
- **SUPERADA:** revisão independente GPT-6 Luna round 2 ocorreu e aprovou a trava/testes sem achados ou ressalvas; ver seção abaixo.
- Sem banco/Docker ou serviços externos; nenhuma alteração de migration, schema, RLS ou grants. Task segue `in_progress`; H-DATA-003/H-DB-003 e a task inteira não estão aprovados.

## Ressalva Opus — revisão independente round 2 — aprovada

- GPT-6 Luna independente retornou `APPROVE`, zero achados e zero ressalvas, limitado à guarda fail-closed do webhook e aos testes. Registro integral: `review-webhook-fail-closed-independent-20261021-r2.md`.
- A guarda aceita somente `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED === '1'` e executa antes de qualquer leitura de header/corpo, lookup de credencial ou persistência. O teste cobre flag ausente, vazia e `true`, comprova que `body.getReader()` não é chamado e confirma os mocks de credencial/persistência sem chamadas.
- Validação final: Vitest 20/20; TypeScript; ESLint direcionado com zero avisos; Prettier; `git diff --check`. Evidência: `validation-webhook-fail-closed-r2-20261021.log`.
- O índice de proveniência agora relaciona 41/41 pareceres Luna persistidos, incluindo as duas rodadas do webhook: `review-provenance-index.md`. As aprovações A1–A5 e do bloqueio/contrato H-DB-003 continuam limitadas aos respectivos escopos.
- **SUPERADA:** próxima ação de revisão final do webhook/task record. O Opus posterior abriu A1–A5; as fatias foram remediadas e A2 segue em revisão.
- Task continua `in_progress`. Não há aprovação da task inteira, H-DATA-003, H-DB-003, integração real, Auth, Storage, Realtime, tráfego de aplicação ou produção.

## Opus follow-up A3 — scope aggregation regression found 2026-10-22

- Re-reading the supplied Opus report against the current working tree showed A3 was not fully resolved: the parser still used normalized free-text Scope values, so historical A3 r1 and A4 r1–r4 remained separate unresolved groups. It also treated review-provenance-index.md as a reviewer report and did not recognize “Ressalvas abertas: zero”.
- Updated scope resolution to prefer finding IDs P0–P3 and Opus round/finding references, use A1–A5 labels in review filenames, group remaining named review rounds by their stable filename category, ignore H-DATA/H-DB roadmap IDs and denied-scope text, and use task as the fallback. The provenance index is excluded from reviewer records.
- Added regression coverage for the A3 round shapes, free-text scopes with H-DATA/H-DB disclaimers, qualified zero caveats, and exclusion of the provenance index. The focused suite passed 31/31; Node syntax, Prettier, and target-file whitespace checks passed. Evidence: validation-a3-scope-remediation-20261022.log.
- Direct aggregation over 42 persisted review records now shows A2–A5, A1, P2-1 through P2-4, P3-1/P3-2, both Opus round-2 findings, and webhook fail-closed approved in their own scopes. The original full working-tree Opus report remains REMEDIATION_REQUIRED; this is intentionally separate from the latest approved slice. No pending scope remains.
- The earlier A3 round-2 approval remains valid only for its reviewed delta. Current A3 status is reopened pending independent GPT-6 Luna read-only round 3 of this correction. Do not claim whole-task or H-DATA-003/H-DB-003 approval.
- **SUPERADA após A3 round 3:** solicitar revisão independente A3 round 3. Ela ocorreu e retornou `REMEDIATION_REQUIRED`; ver registro e correção abaixo. A2 segue bloqueada até A3 ser aprovada.

## SUPERADA — A3 round 3 result and remediation — 2026-10-22

- Independent GPT-6 Luna returned `REMEDIATION_REQUIRED`, one finding, zero caveats, limited to A3. Exact response is preserved verbatim in `review-a3-independent-20261022-r3.md` and indexed in `review-provenance-index.md`.
- Finding: explicit `Scope: P2-2 only — Does not approve P2-3` was combined with `P2-3` from the review filename, incorrectly applying the review to P2-3.
- Correction: explicit finding IDs in `Scope:` now take precedence over filename IDs; explicit A1–A5 labels are recognized. Regression tests cover the P2-2/P2-3 collision and A2 scope in an A3-named file.
- Validation: focused parser tests 33/33; Node syntax checks, Prettier, and targeted `git diff --check` passed. Evidence: `validation-a3-scope-remediation-r3-20261022.log`.
- **SUPERADA após A3 round 4:** a revisão ocorreu e apontou cobertura incompleta de A1–A5; ver correção abaixo.
- **SUPERADA após round 4:** obter re-review A3 round 4; o parecer retornou `REMEDIATION_REQUIRED`.

## A3 — round 4 result and remediation — 2026-10-22

- Independent GPT-6 Luna returned `REMEDIATION_REQUIRED`, one finding, zero caveats, limited to A3. Exact response is preserved verbatim in `review-a3-independent-20261022-r4.md` and indexed in `review-provenance-index.md`.
- Finding: the A1–A5 scope test exercised only A2 and did not make a conflicting filename scope remain distinguishably unresolved.
- Correction: the regression now iterates through A1–A5. For every declared label, a filename naming a different scope has an earlier unresolved finding; a later approval scoped only to the declared label must leave the filename scope unresolved. This detects both an unrecognized A label and accidental union with the filename.
- Validation: focused parser tests 33/33; Node syntax checks, Prettier, and full tracked-tree `git diff --check` passed. Evidence: `validation-a3-scope-remediation-r4-20261022.log`.
- **SUPERADA:** A3 round 5 returned `APPROVE`, zero findings and zero caveats for scope-ID precedence and its regression matrix. Exact reviewer response is preserved in `review-a3-independent-20261022-r5.md`; addendum is indexed in `review-provenance-index.md`.
- A3 approval is limited to that parser correction and tests. The full-tree Opus review remains `REMEDIATION_REQUIRED`; task remains `in_progress`. No approval of the task, H-DATA-003, H-DB-003, Auth, Storage, Realtime, application traffic, or production.
- **A2 correction and live validation complete:** dashboard now labels `currentReview` as aggregate task review state. Focused dashboard/parser/HTTP tests passed 34/34; Node syntax, Prettier, `git diff --check`, and active-record checks passed. After verifying `server.json`, command line, and port ownership, restarted PID 26768 only; new PID 19400 serves port 49213. HTML returned 200 and contained the corrected label; `/api/status` reports this task `in_progress`, `currentReview=REMEDIATION_REQUIRED`, and the current A2 review next step. PID 24904 on port 49214 remained untouched. Evidence: `validation-a2-dashboard-label-20261022.log`, `validation-a2-dashboard-live-final-20261022.log`, and `validation-a2-doc-state-20261022.log`.
- **Next action:** request independent GPT-6 Luna read-only A2 review of the corrected label, current API state, served HTML, and process evidence. Require actual `APPROVE`, zero findings and zero caveats; remediate/review again if needed. Full-tree Opus review remains `REMEDIATION_REQUIRED` until the owner submits a new review.

## A2 — revisão independente round 6 — aprovada — 2026-10-22

- GPT-6 Luna independente revisou somente a clareza do estado agregado e a atualização do painel do proprietário. Resultado real: `APPROVE`, zero achados e zero ressalvas. Resposta preservada em `review-a2-independent-20261022-r6.md`.
- O revisor confirmou `/api/status` e `/dashboard.html` em HTTP 200 com `Cache-Control: no-store`, rótulo novo visível e rótulo antigo ausente. `server.json`, porta e comando confirmam PID 19400 em 49213; PID 24904 em 49214 foi preservado.
- A aprovação cobre somente A2. A1, A3, A4, A5 e a trava fail-closed receberam aprovações independentes limitadas aos respectivos deltas. O parecer Opus de working tree continua `REMEDIATION_REQUIRED`; nenhuma aprovação da task inteira, H-DATA-003 ou H-DB-003.
- **Próxima ação:** conferência final read-only, atualizar o prompt completo para Opus 5.5 em `opus-5.5-review-prompt-after-remediation-20261022.md` e parar aguardando o review do proprietário. Task permanece `in_progress`.

## Fase atualizada — prompt Opus preparado — 2026-10-22

O prompt completo de revisão independente está pronto em opus-5.5-review-prompt-after-remediation-20261022.md. Próxima ação: entregar ao proprietário e aguardar o resultado Opus 5.5. Parar desenvolvimento aqui; task permanece in_progress.

## Novo parecer Opus 5.5 — remediação sequencial — 2026-10-22

- O proprietário forneceu novo `REMEDIATION_REQUIRED` com seis achados. A resposta exata foi preservada em `review-opus-working-tree-20261022.md`. Este resultado integral substitui a antiga próxima ação de aguardar outro review; task continua `in_progress`.
- **Achado 1 — ordenação/agregação de reviews:** correção aplicada em `.harness/dashboard-review-progress.mjs`. Data/hora do nome agora prevalecem sobre rodada e fase; rodada citada como “Opus round N” não é confundida com rodada do revisor; `working tree`/`task` fica no escopo amplo `task`, cujo REMEDIATION_REQUIRED não pode ser vencido por aprovações de fatias. Aprovação ampla posterior substitui reprovação ampla anterior.
- Regressão TDD: três novos casos falharam antes da correção (33 aprovados/3 falhos). Após correção, testes do painel passaram 49/49; sintaxe Node, Prettier e `git diff --check` passaram. Evidência: `validation-review-order-remediation-20261022.log`.
- Revisão independente GPT-6 Luna real do achado 1: `APPROVE`, zero achados e zero ressalvas, limitada a este delta. Resposta preservada em `review-opus-f1-independent-20261022-r1.md`.
- **SUPERADA após re-review do achado 2:** corrigir o destino do log de validação e solicitar nova revisão Luna independente; ver seção abaixo.
- O resultado integral Opus permanece `REMEDIATION_REQUIRED`; task, H-DATA-003 e H-DB-003 sem aprovação global. Preservar todo trabalho local. Sem mudança permanente de schema/RLS/grants, Supabase, VPS, produção, tráfego/dados/credenciais reais, commit, push ou deploy.

## Achado 2 — re-review independente e aprovação limitada — 2026-10-22

- GPT-6 Luna independente round 1 retornou `REMEDIATION_REQUIRED`, com um achado P2: `validate-pool-and-runner.ps1` gravava em pasta/nome da task 20261016, enquanto a evidência citada estava na task atual. Saída integral: `review-opus-f2-independent-20261022-r1.md`.
- Correção mínima: o script agora grava em `.harness/tasks/20261021-113450-6f2c/validation-postgres-runtime-role-guard-$suffix.log`.
- Revalidação PowerShell passou. PostgreSQL descartável `postgres:15`, `--network none`, passou runtime permitido, rejeição de membership `BYPASSRLS`, rejeição de superuser, fixture do runner e limpeza; log reproduzível: `validation-postgres-runtime-role-guard-f07305187b.log`.
- GPT-6 Luna independente round 2 retornou `APPROVE`, zero achados e zero ressalvas, limitado ao achado 2 e à correspondência script/log. Resposta integral: `review-opus-f2-independent-20261022-r2.md`.
- A aprovação não cobre a task inteira. O parecer Opus integral continua `REMEDIATION_REQUIRED`; achados 3–6 seguem abertos. H-DATA-003/H-DB-003 seguem sem aprovação global.
- **Autorização do proprietário (2026-10-22):** criar migration PostgreSQL versionada para o achado 3, validada somente em PostgreSQL descartável no Docker Desktop; não aplicar em banco persistente. **SUPERADA:** implementar migration e validar; executar agora o re-review independente do achado 3.

## Achado 3 — migration runtime instalada — 2026-10-22

- A migration forward-only `supabase/migrations/028_zap_lead_runtime_read_policies.sql` instala políticas runtime de leitura para admin por conta, lookup de credencial escopado pelo GUC da chave, `FORCE ROW LEVEL SECURITY` nas tabelas de integração/estado, grants SELECT somente nas colunas consultadas e execução da função de associação de conta. A política explícita do owner não-login mantém as funções `SECURITY DEFINER` das migrations 025/026 funcionais sob RLS forçada.
- `postgres-zap-lead-webhook-credential-read-fixture.sql` continua como fixture histórica isolada; não prova paridade. A nova validação aplica migrations reais 001–028 antes de semear identidades sintéticas e executar `postgres-zap-lead-webhook-credential-read-integration.mjs`.
- PostgreSQL 16 descartável no Docker Desktop: 28/28 migrations aplicadas; leituras de credencial, configuração/heartbeat e event-stream passaram; isolamento entre contas/chaves, admin-only, grants por coluna, metadados negados, RLS forçada e limpeza da identidade transacional passaram; nenhum container residual. Evidência: `validation-postgres-zap-lead-runtime-migration-3bd9aa1c10.log`.
- Validação adicional: testes focados do runner passaram; parser PowerShell, sintaxe Node, whitespace e `git diff --check` passaram. Prettier não possui parser configurado para `.sql` ou `.ps1`; esse check não foi declarado como aprovação.
- GPT-6 Luna independente round 1 retornou `REMEDIATION_REQUIRED`, um achado P2: o preflight aceitava `wacrm_runtime` com `SUPERUSER`, `BYPASSRLS` ou membership privilegiada. Parecer integral preservado em `review-opus-f3-luna-independent-20261022-r1.md`.
- TDD: a prova negativa falhou contra o preflight original ao demonstrar que ele aceitava `SUPERUSER`; log: `validation-postgres-zap-lead-runtime-migration-4bfd3adaf4.log`.
- Correção: migration 028 agora falha fechado se `wacrm_runtime` tiver `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ou membership a papel privilegiado/incompatível, seguindo a guarda de runtime em `src/lib/db/postgres-pool.ts`. Validador inclui cinco casos negativos de instalação.
- Validação final Docker Desktop: migrations 001–028 aplicadas em PostgreSQL 16 descartável; cinco configurações inseguras rejeitadas; webhook, registration e event-stream mantiveram integração/isolamento; containers removidos. Evidência superseded pela rodada 2 abaixo.
- Node syntax, parser PowerShell, Prettier dos arquivos compatíveis e `git diff --check` passaram. Prettier não tem parser configurado para SQL/PowerShell.
- **Round 2:** revisão GPT-6 Luna independente retornou `REMEDIATION_REQUIRED`, um P2. Membership a `postgres` pode ativar a policy administrativa `FOR ALL TO postgres` via `SET ROLE`; também faltavam testes de papel ausente e owner real da tabela. Parecer integral: `review-opus-f3-luna-independent-20261022-r2.md`.
- Correção: migration e pool runtime agora rejeitam `postgres` e memberships aos owners atuais de `zap_lead_integrations`/`zap_lead_integration_state`, além dos papéis privilegiados existentes. Prova inclui role ausente, atributos administrativos, membership BYPASSRLS, membership `postgres` e membership a owner de tabela sintético.
- Validação final Docker Desktop: migrations 001–028 e integração passaram em PostgreSQL 16 descartável; oito cenários inseguros foram rejeitados; readers passaram e nenhum container ficou. Evidência: `validation-postgres-zap-lead-runtime-migration-e35b5694d4.log`.
- Vitest do pool 23/23, `npx tsc --noEmit`, ESLint focado, Prettier nos arquivos compatíveis, Node syntax, parser PowerShell e `git diff --check` passaram.
- **Estado:** revisão independente GPT-6 Luna read-only round 3 pendente. Avançar ao achado 4 somente após resultado real `APPROVE`, zero achados e zero ressalvas; caso contrário, corrigir e repetir.
- A migration está somente no working tree e foi aplicada apenas ao PostgreSQL descartável. Nenhum banco persistente mudou; task continua `in_progress`, parecer Opus integral permanece `REMEDIATION_REQUIRED`, sem aprovação global de H-DATA-003 ou H-DB-003.

## Achado 3 — revisão independente round 3 — aprovado — 2026-10-22

- GPT-6 Luna independente retornou `APPROVE`, zero achados e zero ressalvas, limitado à migration PostgreSQL runtime, guarda do pool e prova de paridade. Resposta integral: `review-opus-f3-luna-independent-20261022-r3.md`.
- Revisor confirmou rejeição de role ausente, atributos administrativos, memberships privilegiados, `postgres` e owners das relações protegidas; teste restaura estado e integração dos leitores passa após os cenários negativos.
- PostgreSQL 16 descartável: migrations 001–028, oito cenários negativos, leitores e limpeza passaram; sem container residual. Evidência: `validation-postgres-zap-lead-runtime-migration-e35b5694d4.log`.
- Aprovação vale somente ao achado 3. O parecer Opus integral continua `REMEDIATION_REQUIRED`; task, H-DATA-003 e H-DB-003 não estão aprovados globalmente.

## Achado 4 — semântica da flag do webhook — em revisão — 2026-10-22

- A flag `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_ENABLED` sugeria caminho inteiro em PostgreSQL, mas a rota ainda persiste recibos via RPC Supabase. Nenhuma integração Supabase foi acessada nesta remediação.
- Flag renomeada para `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED`. Comentário da rota delimita a flag à leitura de credenciais em PostgreSQL e declara que persistência permanece no RPC existente. Regressão confirma que a flag antiga isolada falha fechada antes da leitura do corpo, lookup ou persistência.
- TDD RED: 20/21 passaram; novo caso falhou porque a flag antiga ainda liberava leitura do corpo. Pós-correção: Vitest 21/21, TypeScript, ESLint direcionado sem avisos, Prettier e `git diff --check` passaram. Evidência: `validation-opus-f4-webhook-flag-20261022.log`.
- Alteração não migra a escrita nem altera migrations/schema/RLS/grants; não houve DB/Docker necessário. Aprovação independente GPT-6 Luna read-only do achado 4 pendente. Se houver achado/ressalva, corrigir e repetir; só avançar ao achado 5 após `APPROVE`, zero achados e zero ressalvas.

## Achado 4 — revisão independente round 1 — aprovado — 2026-10-22

- GPT-6 Luna independente retornou `APPROVE`, zero achados e zero ressalvas, limitado à semântica da flag do webhook e à regressão do nome antigo. Resposta preservada em `review-opus-f4-independent-20261022-r1.md`.
- O revisor confirmou que `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED` identifica somente lookup PostgreSQL, o comentário declara a gravação RPC existente, e a flag antiga sozinha retorna 503 antes de leitura de corpo/lookup/persistência. A revisão foi read-only; validações não foram reexecutadas pelo agente.
- Validação do implementador: `validation-opus-f4-webhook-flag-20261022.log`. Aprovação limitada ao achado 4; parecer Opus integral segue `REMEDIATION_REQUIRED`.
- **Próximo:** tratar achado 5, regressão de contrato/status no resgate de convite. Fazer correção mínima e testes de status/mensagens; pedir revisão independente GPT-6 Luna somente desse delta. Não avançar ao achado 6 sem `APPROVE`, zero achados e zero ressalvas.

## Achado 5 — contrato de resgate de convite — implementação validada, revisão pendente — 2026-10-22

- Teste de contrato ampliado antes da rota: 6/11 passaram e cinco falharam reproduzindo mensagens genéricas/status regressivo; após a correção, 11/11 passaram.
- `repositoryErrorToResponse` agora aplica mapa de status e mensagem fixa para todo `DbErrorCode`. `not_found` volta a HTTP 400; `bad_request` permanece 400; `conflict` preserva 409 e mensagem de ação para o modal. Respostas não expõem mensagens arbitrárias do PostgreSQL. `unauthorized`/`forbidden` permanecem 401 por equivalerem ao caminho de autenticação/perfil; erro de conta é `conflict`.
- Evidência: `validation-opus-f5-invitation-contract-20261022.log`. TypeScript, ESLint direcionado sem avisos, Prettier e `git diff --check` passaram. Sem DB/Docker/Supabase: mudança só no contrato HTTP e nos testes.
- Próximo: revisão independente GPT-6 Luna read-only limitada ao achado 5, rota/teste e log. Corrigir achados/ressalvas e repetir até `APPROVE`, zero/zero; somente então iniciar achado 6.

## Achado 5 — re-review independente após cobertura integrada — 2026-10-22

- A revisão GPT-6 Luna anterior aprovou o contrato HTTP, mas deixou uma ressalva: testes do repositório mockavam `withTransaction` e não provavam conversão integrada de SQLSTATE. Esta ressalva bloqueou avanço ao achado 6.
- O teste do repositório foi alterado para usar `withTransaction` real e pool/cliente simulados. Valida `22023 → bad_request`, `23505 → conflict`, `42501 → unauthorized`, rollback/liberação, sanitização e caminho positivo commit.
- Validação final registrada em `validation-opus-f5-invitation-contract-20261022.log`: Vitest 20/20 (11 rota + 9 repositório), TypeScript, ESLint sem avisos, Prettier e `git diff --check` passaram. PostgreSQL/Docker não necessários; sem Supabase.
- Estado: achado 5 aguarda nova revisão GPT-6 Luna read-only. Não avançar ao achado 6 até `APPROVE`, zero achados e zero ressalvas. Parecer Opus completo segue `REMEDIATION_REQUIRED`; task `in_progress`, sem aprovação global de H-DATA-003/H-DB-003.

## Achado 5 — aprovação independente round 2 — 2026-10-22

- GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitada ao contrato de resgate de convite e à remediação da cobertura transacional integrada. Resposta integral: `review-opus-f5-independent-20261022-r2.md`.
- A ressalva da rodada anterior foi fechada; ver validações finais em `validation-opus-f5-invitation-contract-20261022.log`.
- Achado 5 aprovado somente no escopo descrito. Parecer Opus global permanece `REMEDIATION_REQUIRED`; task `in_progress`, sem aprovação global de H-DATA-003/H-DB-003.
- Próximo: achado 6 — impedir `PASS` indevido no parser de logs de validação diante de `AssertionError` ou `Exit status 1`; primeiro reproduzir os dois casos em testes, corrigir minimamente e validar antes de revisão independente GPT-6 Luna.

## Achado 6 — parser de resultados de validação — implementação validada, revisão pendente — 2026-10-22

- Finding Opus: um log com `Exit code: 0` de um comando e falha não reconhecida (`AssertionError` ou `Exit status 1`) podia ser classificado incorretamente como `PASS` por outra linha de sucesso.
- TDD reproduziu dois casos: `AssertionError` apesar de `Exit code: 0`; `Exit status 1`/`Exit status: 1` apesar de resumo Vitest parcial positivo. Ambos falharam antes da correção.
- Correção mínima em `.harness/dashboard-validation-result.mjs`: detectar `AssertionError` e status de saída não zero antes de qualquer evidência de sucesso. Testes regressivos estão em `.harness/dashboard-validation-result.test.mjs`.
- Validação: quatro suítes do dashboard passaram 51/51; `node --check` nos dois módulos, Prettier e `git diff --check` passaram. Evidência: `validation-opus-f6-dashboard-validation-parser-20261022.log`. Nenhum banco ou serviço acessado.
- Próximo: revisão independente GPT-6 Luna read-only somente do achado 6. Corrigir e repetir se houver qualquer achado/ressalva. Não preparar o prompt Opus final até aprovação sem ressalvas.
- Achados 1–5 têm aprovações Luna limitadas aos respectivos escopos; achado 5 round 2: `review-opus-f5-independent-20261022-r2.md`. Parecer Opus completo segue `REMEDIATION_REQUIRED`; task `in_progress`, sem aprovação global de H-DATA-003/H-DB-003.

## Achado 6 — revisão independente round 1 — sem aprovação — 2026-10-22

- GPT-6 Luna read-only retornou `REMEDIATION_REQUIRED`, zero achados de código e uma ressalva de processo: o agente não encontrou os três artefatos em seu checkout e não conseguiu avaliar a remediação. Parecer integral: `review-opus-f6-independent-20261022-r1.md`.
- Verificação do implementador confirma os artefatos nos caminhos absolutos de `C:\Sistemas\wacrm`. A rodada foi executada a partir de outro diretório/checkout; nenhuma aprovação é presumida.
- Próximo: re-review GPT-6 Luna com os caminhos absolutos do repo e confirmação de leitura dos três artefatos. Não alterar código por este parecer nem avançar ao prompt Opus até revisão efetiva sem achados/ressalvas.

## Achado 6 — revisão independente round 2 — ainda sem aprovação — 2026-10-22

- GPT-6 Luna confirmou que os três caminhos absolutos existem, mas retornou `REMEDIATION_REQUIRED`, um achado e uma ressalva exclusivamente de leitura: a saída do agente foi comprimida/truncada, impedindo confirmar integridade dos trechos e do log. Nenhum defeito concreto de código foi apontado. Parecer integral: `review-opus-f6-independent-20261022-r2.md`.
- A rodada 2 não executou testes nem mudou código. A implementação continua com validação local 51/51 e estática conforme `validation-opus-f6-dashboard-validation-parser-20261022.log`.
- Próximo: re-review read-only GPT-6 Luna, com leitura de fonte/testes em blocos curtos e extração pontual das linhas de resumo do log. Confirmar explicitamente leitura completa antes do veredito. Não aceitar aprovação com qualquer ressalva; não preparar ainda o prompt Opus.

## Achado 6 — revisão independente round 3 — aprovado — 2026-10-22

- GPT-6 Luna read-only confirmou leitura dos três artefatos e retornou `APPROVE`, zero achados e zero ressalvas, limitado ao parser de validação e regressões. Resposta integral: `review-opus-f6-independent-20261022-r3.md`.
- O revisor confirmou as regex `\bExit\s+status\s*:?\s*[1-9]\d*\b` e `\bAssertionError\b`, os dois testes regressivos e a evidência 51/51. As rodadas 1 e 2 não aprovaram por limitações de checkout/leitura e seguem preservadas como histórico; código não foi alterado por elas.
- Todos os seis achados Opus têm aprovações GPT-6 Luna separadas e limitadas aos seus deltas. Parecer Opus de working tree continua `REMEDIATION_REQUIRED` até nova revisão integral; task `in_progress`, sem aprovação global H-DATA-003/H-DB-003.
- Próximo: conferência final read-only de registros/evidências e preparar novo prompt completo Opus 5.5 para o working tree atual; depois parar e aguardar o parecer do proprietário.

## Correção suplementar — API de validações do painel — 2026-10-22

- A conferência final encontrou `/api/status` com `validations: []` embora a task ativa tivesse 102 artefatos elegíveis. `collectValidationFiles` chamava `classifyReview` sem import; o `catch` ocultava a exceção. Import corrigido em `.harness/dashboard-server.mjs`.
- TDD reproduziu a lista vazia. A primeira regressão usou artefatos da task ativa; GPT-6 Luna round 1 apontou uma ressalva P3 de durabilidade. Corrigida com fixture hermética: o teste copia o servidor e dependências para repositório temporário e cria task, validação e review sintéticos. Não depende da task ativa ou dos dez registros mais recentes.
- As quatro suítes do painel passaram 51/51; `node --check`, Prettier e `git diff --check` passaram. Evidência: `validation-dashboard-validation-list-20261022.log`.
- GPT-6 Luna independente round 2: `APPROVE`, zero achados e zero ressalvas, limitado ao import e ao teste HTTP hermético. Registro: `review-dashboard-validation-list-independent-20261022-r2.md`. Round 1 e ressalva P3 preservados em `review-dashboard-validation-list-independent-20261022-r1.md`.
- Painel reiniciado/verificado: PID 24872 serve `127.0.0.1:49213`; API/HTML 200, no-store, polling 20 min e 10 evidências disponíveis. A instância separada PID 24904 na 49214 permanece intacta.
- Todos os seis achados do parecer Opus mais recente têm aprovação independente Luna limitada a cada delta. O parecer integral continua `REMEDIATION_REQUIRED`; task `in_progress`; sem aprovação global H-DATA-003/H-DB-003.

## Próxima ação

Os cinco findings do parecer Opus r2 têm aprovações GPT-6 Luna limitadas aos respectivos deltas. O finding 1 recebeu follow-up aprovado para fechar a rota indireta de eventos; o follow-up da ressalva 6b também foi aprovado para propagar falhas de leitura de task/review. A próxima ação é documentar e revisar a ressalva 7: flag do webhook ausente ou diferente de `1` produz HTTP 503 fail-closed. Depois, tratar as ressalvas 8 e 9, uma por vez. A ressalva 1 continua aberta até revisão integral da cobertura.

O prompt Opus integral será preparado após os deltas e caveats acionáveis estarem remediados e aprovados. A task permanece `in_progress`; não marcar como concluída nem declarar aprovação global de H-DATA-003/H-DB-003. Tratar um item por vez e repetir o review independente GPT-6 Luna até `APPROVE`, zero achados e zero ressalvas.

## Parecer Opus 5.5 full-tree r2 — 2026-10-22

Parecer integral salvo em `review-opus-working-tree-20261022-r2.md`: `REMEDIATION_REQUIRED`, cinco findings (P1: rotas PostgreSQL sem gate/grants completos; P2: UPDATE de `flow_runs` sem policy; P2: 42501 ACL confundido com falha de autenticação; P3: parser não reconhece resumo `node:test`; P3: parser de review trunca HHMMSS e não reconhece `árvore` como escopo amplo). Reviewer registrou nove ressalvas; cobertura incompleta (1.516 entradas) e nenhuma execução impedem aprovação integral.

O quadro do parecer confirma os seis achados anteriores e o import do `classifyReview` corrigidos nos escopos limitados. Há resíduos novos nos cinco findings acima. Riscos técnicos/documentais das ressalvas também serão avaliados; não tratar coverage, logs nem reviews limitados como prova de aprovação global.

Sequência: um finding por vez, TDD/validação focada, review independente GPT-6 Luna read-only após cada correção até `APPROVE`, zero findings e zero caveats. Não usar Supabase; sem banco persistente, VPS, produção, dados/credenciais/tráfego reais, commit, push ou deploy. Só PostgreSQL descartável em Docker Desktop quando necessário. Manter H-DATA-003/H-DB-003 sem aprovação global.

## Opus r2 — finding 1: gate fail-closed nas APIs PostgreSQL — 2026-10-22

- Finding: 25 rotas que importam repositórios PostgreSQL estavam acessíveis sem grants/policies de runtime completos. Alterar grants da aplicação permanece fora deste delta e da H-DB-003.
- Remediação: middleware bloqueia `/api/account`, `/api/automations`, `/api/flows`, `/api/invitations`, `/api/whatsapp` e `/api/zap-lead/registration` com HTTP 503 e `Cache-Control: no-store` antes de criar cliente de autenticação, salvo quando `WACRM_POSTGRES_APP_API_ENABLED` é exatamente `1`. Nenhum fallback Supabase nem grants foram adicionados. O acesso à variável no middleware usa propriedade estática, conforme a documentação Edge/variáveis de ambiente do Next.js; o template local documenta que a flag deve permanecer ausente até a revisão de readiness.
- Cobertura: teste enumera route handlers que importam repositórios e exige que todos caiam no gate. Inventário atual: 25/25 cobertos, zero fora das famílias. Teste de middleware verifica 503 antes da autenticação e liberação apenas com flag `1`.
- Validação focada: Vitest 5/5; ESLint direcionado sem avisos; Prettier check; `tsc --noEmit`; `git diff --check`; inventário 25/25. Log: `validation-opus-f1-postgres-api-gate-20261022.log`. Nenhum banco, Docker, serviço externo ou dado real acessado nesta fatia.
- Estado: implementação validada; review independente GPT-6 Luna read-only pendente. Não avançar ao finding 2 até `APPROVE`, zero findings e zero caveats. Task geral e parecer Opus continuam `in_progress`/`REMEDIATION_REQUIRED`; H-DATA-003 e H-DB-003 não aprovadas globalmente.

- Independent GPT-6 Luna read-only review approved finding 1 with zero findings and zero caveats; record: `review-opus-f1-independent-20261022-r1.md`. Approval is limited to the fail-closed gate delta and 25-route coverage. Full Opus review remains `REMEDIATION_REQUIRED`.

## Opus r2 — finding 2: fail-closed pause of active Flow runs — 2026-10-22

- Finding: the WhatsApp send route ignored a false pause result and logged pause errors after the provider had accepted the message, allowing an active automation to continue.
- Remediation: repository now reads the visible active run first. No visible active run remains a safe no-op; if an active run is visible but UPDATE returns zero rows (for example, because RLS has no UPDATE policy), repository raises `db_error`. Route pauses before calling the provider and returns HTTP 503 on pause failure, so neither provider send nor message persistence occurs. A manual-send attempt pauses the run even if the provider subsequently rejects the send; this prioritizes preventing automation from racing a human takeover.
- No migration, RLS policy, grant, Supabase fallback, or persistent database change was added. APIs remain gated by P1 until the complete runtime contract is approved under H-DB-003.
- TDD RED: six focused assertions failed before implementation; evidence `tdd-red-opus-f2-flow-pause-20261022.log`. Final focused Vitest: 30/30; ESLint `--max-warnings=0`, Prettier check, `tsc --noEmit`, and `git diff --check` passed.
- PostgreSQL 16 disposable Docker Desktop reproduction (`--network none`, `--rm`, no port/volume) confirmed one active row is visible under migration 017's SELECT-only policy while UPDATE without an UPDATE policy changes zero rows. Fixture: `postgres-flow-run-pause-rls-fixture.sql`; evidence: `validation-opus-f2-flow-pause-20261022.log`. Container was stopped and removed.
- Estado: implementation and focused validation complete; independent GPT-6 Luna read-only review pending. Do not start finding 3 until `APPROVE`, zero findings and zero caveats. Full Opus review remains `REMEDIATION_REQUIRED`; H-DATA-003/H-DB-003 are not globally approved.

- Independent GPT-6 Luna read-only review approved finding 2 with zero findings and zero caveats; record: `review-opus-f2-independent-20261022-r1.md`. Approval is limited to the Flow-pause delta. Next: finding 3, SQLSTATE 42501 classification; full Opus review remains `REMEDIATION_REQUIRED`.

## Opus r2 — finding 3: invitation RPC SQLSTATE classification — 2026-10-22

- Finding: invitation redemption mapped every SQLSTATE `42501` to `unauthorized`, including PostgreSQL EXECUTE ACL denial (`aclcheck_error`), hiding a runtime-grant/configuration failure as HTTP 401 and skipping the existing `db_error` log path.
- Remediation: `toAppError` preserves the PostgreSQL error `routine` for `42501` internally; redemption maps only routine `exec_stmt_raise` (the intentional PL/pgSQL RPC rejection) to `unauthorized`. ACL and other routines remain `db_error`, preserving the sanitized/logged 500 response.
- TDD reproduced the ACL misclassification before the source change. Regression cases cover `exec_stmt_raise` and `aclcheck_error` through the real `withTransaction` boundary with a mocked pg client; both verify rollback, release, and safe messages.
- Focused Vitest passed 21/21. ESLint `--max-warnings=0`, Prettier, `tsc --noEmit`, and targeted `git diff --check` passed. Evidence: `validation-opus-f3-invitation-sqlstate-20261022.log`.
- No PostgreSQL, Docker, Supabase, external service, persistent DB, real data, or credentials were used for this code-only slice. No commit, push, or deploy.
- State: implementation validated; independent GPT-6 Luna read-only review pending. Do not begin finding 4 until `APPROVE`, zero findings, zero caveats. Full Opus review remains `REMEDIATION_REQUIRED`; task `in_progress`; H-DATA-003/H-DB-003 remain unapproved globally.

## Opus r2 — finding 3 independent review — approved — 2026-10-22

- GPT-6 Luna independent read-only review returned `APPROVE`, zero findings and zero caveats, limited to distinguishing intentional invitation RPC rejection from SQLSTATE `42501` EXECUTE ACL denial. Verbatim record: `review-opus-f3-independent-20261022-r1.md`.
- Reviewer confirmed only `exec_stmt_raise` maps to `unauthorized`; `aclcheck_error`, unknown routine and missing routine fail closed to `db_error`. Routine metadata stays non-enumerable; the route logs `db_error`, returns the established sanitized 500, and does not expose driver metadata.
- Validation evidence: `validation-opus-f3-invitation-sqlstate-20261022.log` (21/21 focused tests; ESLint, Prettier, TypeScript and targeted whitespace check passed). The reviewer performed no tests or external access.
- Approval is limited to finding 3. Full Opus r2 remains `REMEDIATION_REQUIRED`; task remains `in_progress`; H-DATA-003/H-DB-003 are not globally approved.
- Next: finding 4, failure detection for `node:test` output. Keep findings sequential; do not begin finding 5 until its own GPT-6 Luna review returns `APPROVE`, zero findings and zero caveats.

## Opus r2 — finding 4: node:test failure summaries — implementation validated — 2026-10-22

- Finding: dashboard could classify failed Node test output as `PASS` when an `ℹ fail 1`, `# fail 1`, or `not ok ...` record was followed by unrelated successful output such as `Exit code: 0`.
- TDD reproduced the failure: `ℹ fail 1` plus success evidence returned `PASS` before the parser change.
- Remediation: `.harness/dashboard-validation-result.mjs` now treats nonzero `ℹ fail N` and `# fail N` summaries and TAP `not ok` records as failure before checking success evidence. Tests also confirm zero counts do not fail.
- Validation: Node test 13/13; `node --check` for both files; Prettier and targeted `git diff --check` passed. The initial Prettier check found formatting in the test; formatter was applied and final check passed. Evidence: `validation-opus-f4-node-test-parser-20261022.log`.
- No DB, Docker, Supabase, external service, real data, or credentials accessed. No commit, push, or deploy.
- State: independent GPT-6 Luna read-only review pending. Do not start finding 5 before `APPROVE`, zero findings and zero caveats. Full Opus r2 remains `REMEDIATION_REQUIRED`; task `in_progress`; H-DATA-003/H-DB-003 are not globally approved.

## Opus r2 — finding 4 independent review — approved — 2026-10-22

- GPT-6 Luna independent read-only review returned `APPROVE`, zero findings and zero caveats, limited to node:test/TAP failure parsing. Record: `review-opus-f4-independent-20261022-r1.md`.
- Reviewer confirmed failure evidence precedes success; positive `ℹ fail N` / `# fail N` counts and `not ok` records fail, while zero summary counts do not.
- Validation evidence: `validation-opus-f4-node-test-parser-20261022.log` (13/13 tests, syntax, Prettier and targeted whitespace checks passed). Reviewer did not rerun tests or services.
- Approval is limited to finding 4. Full Opus r2 remains `REMEDIATION_REQUIRED`; task remains `in_progress`; H-DATA-003/H-DB-003 are not globally approved.
- Next: finding 5, review timestamp `HHMMSS` truncation and Portuguese `árvore` scope recognition. Then evaluate/document all nine Opus caveats before requesting a new full-tree Opus review.

## Opus r2 — finding 5: review timestamp and Portuguese scope parser — implementation validated — 2026-10-22

- Finding: the review-order parser consumed `HHMM` from `HHMMSS`, tying reviews in the same minute; ASCII `\b` did not recognize the accented initial letter in `árvore de trabalho`, so a later broad approval could fail to supersede a broad rejection.
- TDD added same-round/same-phase reviews at `20:15:21` and `20:15:59`, and a broad `árvore de trabalho, A1–A5` approval after a broad rejection. Both regressions failed before implementation (38 pass, 2 fail).
- Remediation: parse six-digit time before four-digit time; use a Unicode letter boundary before broad-scope phrases while retaining the existing ASCII end boundary.
- Validation: focused parser suite 40/40; all four dashboard suites 56/56; Node syntax, Prettier, and targeted `git diff --check` passed. Evidence: `validation-opus-f5-review-parser-20261022.log`.
- No DB, Docker, Supabase, external service, real data, or credentials accessed. No commit, push, or deploy.
- State: independent GPT-6 Luna read-only review pending. Full Opus r2 remains `REMEDIATION_REQUIRED`; task `in_progress`; H-DATA-003/H-DB-003 are not globally approved. After review, assess all nine caveats and document each outcome before requesting a new full-tree Opus review.

## Opus r2 — finding 5 independent review — approved — 2026-10-22

- GPT-6 Luna independent read-only review returned `APPROVE`, zero findings and zero caveats, limited to timestamp precision and Portuguese broad-scope recognition. Record: `review-opus-f5-independent-20261022-r1.md`.
- Reviewer confirmed the same-round/same-phase regression verifies six-digit ordering, `árvore de trabalho` uses a Unicode boundary, task-wide scopes remain separate from narrower scopes, and broad approval cannot clear a narrower conflict.
- Validation evidence: `validation-opus-f5-review-parser-20261022.log` (40/40 focused, 56/56 all dashboard suites, syntax, Prettier, targeted whitespace check passed). Reviewer did not rerun tests/services.
- Approval is limited to finding 5. All five Opus r2 findings now have individual zero/zero Luna approvals; full Opus r2 remains `REMEDIATION_REQUIRED`. Task stays `in_progress`; H-DATA-003/H-DB-003 are not globally approved.
- Next: inspect and disposition each of the nine caveats, make only scoped fixes needed, preserve evidence, then prepare a new full-tree Opus 5.5 read-only review prompt and stop for the owner's review.

## Opus r2 caveat 3 — papel proprietário de migrations — revisão pendente — 2026-10-22

`runMigrations` agora rejeita `ownerRole` diferente de `DEFAULT_OWNER_ROLE` (`postgres`) antes de descobrir migrations ou chamar `pool.connect`. A cadeia atual contém migrations com `OWNER TO postgres`; aceitar outro nome sem adaptar essa cadeia produziria uma configuração enganosa. Teste regressivo confirma que papel alternativo falha antes de qualquer conexão.

Validação final: `scripts/migrate-postgres.test.mjs` passou 22/22; `node --check`, Prettier e `git diff --check` passaram. Evidência: `validation-caveat-3-owner-role-20261022.log`. A primeira checagem Prettier falhou e foi corrigida por formatação; o log preserva a falha inicial e a execução final aprovada. Sem banco, Docker ou serviço externo.

Próximo: revisão GPT-6 Luna independente e read-only, limitada à guarda, teste e evidência desta ressalva. Não avançar antes de `APPROVE`, zero achados e zero ressalvas. A revisão integral Opus continua `REMEDIATION_REQUIRED`; task `in_progress`; nenhuma aprovação global de H-DATA-003/H-DB-003.

## Opus r2 caveat 3 — revisão independente aprovada — 2026-10-22

GPT-6 Luna read-only retornou `APPROVE`, 0 findings e 0 caveats para a guarda do papel proprietário de migrations. Registro: `review-opus-c3-owner-role-independent-20261022.md`. A aprovação confirma que a cadeia versionada fixa `OWNER TO postgres` e que o runner rejeita configuração alternativa antes de descobrir migrations ou conectar ao pool; teste regressivo verifica ausência de conexão. Evidência de validação: `validation-caveat-3-owner-role-20261022.log` (22/22 e checks estáticos aprovados).

Escopo limitado à ressalva 3; review Opus integral segue `REMEDIATION_REQUIRED`. Próxima: ressalva 4, GUC de `key_id` como contexto não confiável/defesa adicional. H-DATA-003/H-DB-003 não aprovados globalmente.

## Opus r2 caveat 4 — limite do GUC `key_id` — revisão pendente — 2026-10-22

O GUC `app.wacrm_zap_lead_webhook_key_id` é definido pela própria sessão `wacrm_runtime`; portanto, a policy por `key_id` é um filtro de defesa em profundidade contra consulta acidental sem escopo, não uma fronteira de autenticação/isolamento contra runtime comprometido. O comentário do repositório agora explicita esse limite. Não alterei SQL, migration, grants ou policy versionada.

A evidência PostgreSQL descartável existente cobre lookup via forced RLS, escopo de colunas e limpeza transaction-local do GUC: `validation-postgres-zap-lead-webhook-credential-read-e5cd5eb3d7.log`. Checagem de Prettier e `git diff --check` passaram; nenhum teste ou serviço foi executado para mudança apenas documental. Registro: `validation-caveat-4-guc-boundary-20261022.log`.

Próximo: revisão independente GPT-6 Luna read-only deste limite e sua documentação. Avançar só com `APPROVE`, zero achados e zero ressalvas. H-DATA-003/H-DB-003 e review Opus integral permanecem sem aprovação global.

## Opus r2 caveat 4 — revisão independente aprovada — 2026-10-22

GPT-6 Luna read-only retornou `APPROVE`, 0 findings e 0 caveats, limitado à documentação do GUC de `key_id`. Registro: `review-opus-c4-guc-boundary-independent-20261022.md`. Confirmou que o GUC é caller-settable por `wacrm_runtime`, serve como defesa em profundidade contra consulta acidental sem escopo e não é fronteira independente de autenticação/tenant contra runtime comprometido; a autenticação do webhook continua responsabilidade do handler. Nenhuma policy, grant, migration ou comportamento de rota foi alterado.

Validação documental: Prettier e `git diff --check` aprovados; evidência `validation-caveat-4-guc-boundary-20261022.log`. Aprovação limitada à ressalva 4. Próxima: ressalva 5, ownership de outras tabelas pelo papel runtime e RLS sem `FORCE`. Review Opus integral permanece `REMEDIATION_REQUIRED`; sem aprovação global H-DATA-003/H-DB-003.

## Opus r2 caveat 5 — ownership de tabelas do runtime — implementação validada, revisão pendente — 2026-10-22

A guarda do pool agora rejeita o papel efetivo/de sessão quando possui qualquer tabela comum ou particionada de schema não sistêmico; `pg_catalog`, `pg_temp_*` e `information_schema` ficam fora. Dono de tabela pode contornar RLS sem `FORCE` e pode alterar a policy; ownership deixa de ser permitido ao runtime.

TDD red: `validation-postgres-runtime-role-guard-e38dc35fd3.log` mostrou que a conexão antes passava mesmo com `wacrm_runtime` dono de tabela RLS sem `FORCE`; container foi removido. Validação final: `validation-postgres-runtime-role-guard-373bf73c91.log` passou em PostgreSQL 15 descartável, `--network none`, com limpeza; o probe do owner foi rejeitado antes da query e os cenários de runtime comum, membership `BYPASSRLS`, superuser e runner passaram. Foco Vitest do pool 23/23; TypeScript, ESLint `--max-warnings=0`, Prettier, parser PowerShell e `git diff --check` passaram. Log agregado: `validation-caveat-5-pool-ownership-20261022.log`.

Próximo: revisão independente GPT-6 Luna read-only, limitada à guarda, regressão e evidência. Não avançar antes de `APPROVE`, zero achados e zero ressalvas. Review Opus integral permanece `REMEDIATION_REQUIRED`; task `in_progress`; sem aprovação global H-DATA-003/H-DB-003.

## Opus r2 caveat 5 — revisão independente aprovada — 2026-10-22

GPT-6 Luna read-only retornou `APPROVE`, zero findings e zero caveats, limitado à guarda contra ownership de tabelas pelo runtime. Registro: `review-opus-c5-pool-ownership-independent-20261022.md`. O revisor confirmou que a query inclui todos os donos de tabelas regulares/particionadas em schemas não sistêmicos, exclui schemas `pg_*`/`information_schema`, e bloqueia o runtime antes da query, inclusive no probe RLS sem `FORCE`.

Validação: PostgreSQL descartável `--network none` com cleanup; TDD red e prova final registradas nos logs `validation-postgres-runtime-role-guard-e38dc35fd3.log` e `validation-postgres-runtime-role-guard-373bf73c91.log`. Vitest 23/23, TypeScript, ESLint, Prettier, parser PowerShell e `git diff --check` passaram; evidência agregada `validation-caveat-5-pool-ownership-20261022.log`. Aprovação limitada à ressalva 5.

## Opus r2 — ressalva 6a: janela da guarda de papel — aprovada por Luna — 2026-10-22

assertLeastPrivilegeRuntimeRole executa em pg.Pool.onConnect, uma vez por conexão física nova. Não é atômica com cada consulta de negócio. Mudanças administrativas de papel ou policy podem afetar sessões existentes independentemente; drenar/reiniciar o pool fecha conexões antigas e faz as substitutas passarem novamente pela guarda. Isso não é pré-requisito para a alteração no PostgreSQL entrar em vigor. O comentário em src/lib/db/postgres-pool.ts explicita esses limites.

Disposição: manter este limite como fronteira operacional explícita. O administrador do PostgreSQL é uma autoridade confiável que pode alterar papéis e políticas; a aplicação não consegue neutralizar esse controle administrativo. Com o papel corretamente provisionado, o isolamento por conta depende das policies RLS em cada operação. O guard de conexão não impede que mudanças administrativas posteriores alterem essa fronteira. Provisionamento do papel runtime e policies/grants instaláveis continuam bloqueados pela H-DB-003; o parecer Opus identifica que o working tree não pode ser implantado antes dessa resolução.

GPT-6 Luna read-only round 1 pediu precisão temporal; a redação foi corrigida. Round 2 retornou APPROVE, zero achados e zero ressalvas, limitada à ressalva 6a; resposta integral em review-opus-c6a-independent-20261022-r2.md. Validação documental em validation-caveat-6a-role-check-boundary-20261022.log. Nenhum comportamento SQL, migration, grant ou policy foi alterado. Parecer Opus integral continua REMEDIATION_REQUIRED; task in_progress; sem aprovação global H-DATA-003/H-DB-003.

## Opus r2 — ressalva 6b: erros ao ler evidências do painel — validação concluída, revisão pendente — 2026-10-22

`collectValidationFiles` não captura mais falhas de `readdir`, `stat` ou leitura por arquivo e não as converte em uma lista vazia. O handler de `/api/status` responde com HTTP 500 e mensagem sanitizada. O teste HTTP aponta o task fixture para um diretório de evidências ausente e exige esse 500.

TDD red descartável reproduziu 200 antes da correção; registro `tdd-red-opus-c6b-dashboard-validation-read-20261022.log`. Luna round 1 encontrou que `readText` ainda engolia erro de leitura de arquivo individual; parecer integral em `review-opus-c6b-independent-20261022-r1.md`. A correção extraiu o collector para `.harness/dashboard-validation-files.mjs`, cuja leitura estrita propaga a falha; teste determinístico injeta `EACCES` em `readFile`. Simulação descartável do comportamento antigo (`catch { return '' }`) fez a nova regressão falhar, em `tdd-red-opus-c6b-readfile-20261022.log`. As cinco suítes do painel passaram 58/58, incluindo o caso `readFile` e o HTTP 500 sanitizado para diretório ausente. `node --check`, Prettier `--check` e `git diff --check` passaram. Evidência: `validation-opus-c6b-dashboard-validation-read-20261022.log`.

## Opus r2 — ressalva 6b — aprovada por Luna — 2026-10-22

GPT-6 Luna round 2 retornou `APPROVE`, zero achados e zero ressalvas, limitada à ressalva 6b. Confirmou que `readFile` individual propaga o erro, a regressão determinística injeta `EACCES`, e o handler retorna HTTP 500 sanitizado para falhas de coleta. Registro integral: `review-opus-c6b-independent-20261022-r2.md`.

Validação: cinco suítes do painel 58/58, incluindo regressão de leitura individual e erro HTTP; `node --check`, Prettier `--check` e `git diff --check` aprovados. Evidências: `validation-opus-c6b-dashboard-validation-read-20261022.log`, `tdd-red-opus-c6b-dashboard-validation-read-20261022.log` e `tdd-red-opus-c6b-readfile-20261022.log`.

Próximo: avaliar as ressalvas Opus 1, 2, 7, 8 e 9, preservando a limitação da aprovação parcial. A revisão Opus integral continua `REMEDIATION_REQUIRED`; task `in_progress`; H-DATA-003/H-DB-003 sem aprovação global.

## Opus r2 — ressalva 2: reviewer não executou comandos — disposição documental — 2026-10-22

O parecer Opus r2 é revisão read-only e declarou que não executou comandos. Seus achados permanecem conclusões da leitura de código; nenhum teste ou resultado de banco é atribuído ao revisor. As validações foram executadas separadamente pelo implementador e registradas por delta; cada remediação também recebeu revisão independente GPT-6 Luna limitada. Evidência de processo: `validation-opus-c2-review-evidence-20261022.log`.

No próximo prompt Opus, exigir leitura dos logs citados e distinção explícita entre inspeção do revisor e execução do implementador. Não presumir que o Opus executou validações. A aprovação integral continua pendente.

## Opus r2 — caveat 2 — disposição documental aprovada por Luna — 2026-10-22

Revisão GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitada à proveniência dos resultados de validação. Registro: `review-opus-c2-review-evidence-independent-20261022.md`. Confirma que Opus declarou não ter executado comandos e que os logs são atribuídos ao implementador. Esta ressalva está resolvida no escopo documental; não aprova a task nem H-DATA-003/H-DB-003.

## Opus r2 — finding 1 follow-up — gate da rota de eventos Zap Lead — 2026-10-22

Auditoria read-only de cobertura encontrou `/api/zap-lead/events/stream` usando `createPostgresZapLeadEventStreamReadRepository` por import indireto, mas fora do `postgresBackedRoutePrefixes`. Um teste novo falhou antes da correção (1 falha, 3 passavam). O prefixo `/api/zap-lead/events` e a regressão explícita foram adicionados; o middleware bloqueia a rota antes da inicialização/auth do Supabase quando a flag não é exatamente `1`.

Validação: gate Vitest 4/4, Prettier, ESLint sem warnings, `tsc --noEmit` e `git diff --check` passaram. Evidência: `validation-opus-f1-zap-lead-event-stream-gate-20261022.log`. GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitado a este follow-up; resposta em `review-opus-f1-event-stream-gate-independent-20261022.md`. Nenhuma migration, policy, grant ou banco foi alterado.

## Estado atual das ressalvas Opus r2 — após auditoria de cobertura — 2026-10-22

- Ressalva 1 permanece aberta: a auditoria adicional não leu cada arquivo do working tree e não sustenta afirmar cobertura integral. Ela encontrou e corrigiu o caminho indireto acima, aprovado por Luna apenas nesse delta.
- Ressalva 2 está documentalmente resolvida por revisão limitada, registrada acima; o reviewer Opus não executou comandos.
- Ressalvas 3, 4, 5, 6a e 6b têm revisões Luna limitadas aprovadas. A aprovação 6b cobre apenas a coleta de evidências de validação; uma auditoria posterior observou que `readText()` ainda converte falhas de leitura de `current-task.md`, `task.md` e reviews em texto vazio. Avaliar e testar esse caminho antes de considerar eliminada toda falha silenciosa de leitura do painel.
- Ressalvas 7, 8 e 9 permanecem abertas: explicitar HTTP 503 fail-closed quando a flag do webhook está ausente; corrigir o texto desatualizado sobre migration 028 em `HANDOFF-CONTEXT.md`; confirmar/documentar quais repositórios de automação são usados em runtime e o limite de policy de escrita.

Próximo: remediar e revisar independentemente o caminho `readText()`; depois tratar ressalvas 7, 8 e 9, e deixar a cobertura integral para novo review Opus com leitura explícita do working tree e evidências. Task `in_progress`; revisão Opus r2 integral `REMEDIATION_REQUIRED`; H-DATA-003/H-DB-003 sem aprovação global.

## Opus r2 — ressalva 6b follow-up — leitura de tasks/reviews aprovada por Luna — 2026-10-22

GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitado à propagação de erros de leitura de `current-task.md`, `task.md`, reviews e coleta de status. Registro integral: `review-opus-c6b-task-review-read-independent-20261022.md`. TDD reproduziu HTTP 200 com EACCES antes da correção; após remover o catch genérico, a rota responde HTTP 500 sanitizado. Cinco suítes do painel passaram 59/59; syntax, Prettier, ESLint dos arquivos novos e `git diff --check` passaram. Evidências: `tdd-red-opus-c6b-task-review-read-20261022.log` e `validation-opus-c6b-task-review-read-20261022.log`.

Próximo: corrigir e revisar a ressalva 8, atualizando a descrição da migration 028 em `HANDOFF-CONTEXT.md`. Em seguida, confirmar/documentar a ressalva 9 sobre uso runtime e policies dos repositórios de automação. Caveat 1 continua aberta por cobertura incompleta; caveats 2–7 têm aprovação apenas em seus escopos. Opus integral continua `REMEDIATION_REQUIRED`; task `in_progress`; sem aprovação global H-DATA-003/H-DB-003.

## Opus r2 — ressalva 7 — comportamento fail-closed do webhook documentado — 2026-10-22

`HANDOFF-CONTEXT.md` agora declara que a flag `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED` ausente ou diferente de `1` deixa `POST /api/zap-lead/webhook` indisponível com HTTP 503 genérico, antes de ler a requisição ou consultar credenciais, sem fallback silencioso. Isso descreve o comportamento existente, não altera código nem habilita a flag.

Evidência de código/teste já existente: `src/app/api/zap-lead/webhook/route.ts`, `validation-webhook-fail-closed-r2-20261021.log` e `review-webhook-fail-closed-independent-20261021-r2.md`. Validação desta edição documental registrada em `validation-opus-c7-webhook-fail-closed-documentation-20261022.log`. Revisão independente GPT-6 Luna deste delta: pendente; não avançar até `APPROVE`, zero achados/ressalvas.

GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitado à disposição documental da caveat 7. Registro: `review-opus-c7-webhook-fail-closed-documentation-independent-20261022.md`. Esta aprovação não cobre o caminho quando a flag está habilitada nem a task global.

## Opus r2 — ressalva 8 — fronteira da migration 028 corrigida; revisão pendente — 2026-10-22

`HANDOFF-CONTEXT.md` agora informa que `supabase/migrations/028_zap_lead_runtime_read_policies.sql` cria policies com RLS forçada e grants mínimos por coluna para `zap_lead_integrations` e `zap_lead_integration_state`, inclusive a policy de lookup por `key_id`; exige `wacrm_runtime` preexistente e validado pelo preflight, mas não cria o papel. Também explicita que a migration não fecha a matriz de privilégios das demais rotas e RPCs, e que o teste é só em PostgreSQL descartável.

`git diff --check -- HANDOFF-CONTEXT.md` passou. `npx prettier --check HANDOFF-CONTEXT.md` falha tanto na árvore atual quanto no conteúdo de `HEAD`; sem formatar o arquivo inteiro para evitar churn fora da correção. Evidência: `validation-opus-c8-migration-boundary-20261022.log`. Nenhum teste, banco, Docker ou serviço foi usado nesta alteração documental.

Próximo: revisão independente GPT-6 Luna read-only somente desta correção documental; avançar após `APPROVE`, zero achados e zero ressalvas. A revisão Opus integral continua `REMEDIATION_REQUIRED`; caveat 1 permanece aberta pela cobertura parcial; H-DATA-003/H-DB-003 continuam sem aprovação global.

## Opus r2 — ressalva 8 — aprovada por Luna — 2026-10-22

GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas, limitado à precisão da descrição da migration 028 e da fronteira PostgreSQL. Registro integral: `review-opus-c8-migration-boundary-independent-20261022.md`. Evidência e limitação do Prettier: `validation-opus-c8-migration-boundary-20261022.log`. Não aprova a task, o review Opus completo, H-DATA-003 ou H-DB-003.

## Opus r2 — ressalva 9 — chamadores e fronteira de RLS da automação documentados — 2026-10-22

Inspeção estática de `src` confirmou que `GET /api/automations/[id]/logs` usa o repositório PostgreSQL de leitura `automation-logs`. Os repositórios PostgreSQL de escrita `automation-log-create`, `automation-log-append` e `automation-log-finalize`, e de fila `automation-pending-schedule`, `automation-pending-claim` e `automation-pending-finalize`, não têm import/chamador de produção em `src`; usos encontrados são testes e integrações de validação. O fluxo ativo permanece no caminho Supabase: `src/lib/automations/engine.ts` grava logs e agenda execuções pendentes via `supabaseAdmin`, e `src/app/api/automations/cron/route.ts` lê e reivindica execuções com `supabaseAdmin`.

Migrations 006 e 017 documentam `automation_pending_executions` como service-role-only, sem policies RLS para clientes; a migration 017 dá a `automation_logs` policy de SELECT, sem policy de escrita para clientes. Nenhuma migration inspecionada provisiona grants/policies de escrita de `wacrm_runtime` nessas tabelas. Portanto, fixtures PostgreSQL desses repositórios não provam que estejam integrados ou autorizados para o runtime; escrita PostgreSQL futura depende da matriz H-DB-003. Essa distinção foi registrada em `HANDOFF-CONTEXT.md`, sem alterar código, schema ou policies.

Validação documental estática e `git diff --check` passaram; nenhum teste, banco ou serviço foi usado. Evidência: `validation-opus-c9-automation-runtime-boundary-20261022.log`. Aguardar revisão independente GPT-6 Luna read-only somente desta disposição; caveat 1 segue aberta por cobertura incompleta. Review Opus integral `REMEDIATION_REQUIRED`; H-DATA-003/H-DB-003 sem aprovação global.

## Opus r2 — ressalva 9 — aprovada por Luna — 2026-10-22

GPT-6 Luna independente retornou `APPROVE`, zero achados e zero ressalvas, limitada à disposição de uso runtime e policies da automação. Confirmou o consumidor de produção do leitor PostgreSQL `automation-logs`, a ausência em `src` de chamadores de produção para os repositórios PostgreSQL de escrita/fila, o caminho ativo via `supabaseAdmin` e a fronteira RLS documentada nas migrations. Registro integral: `review-opus-c9-automation-runtime-boundary-independent-20261022.md`. Aprovação não cobre a task nem H-DATA-003/H-DB-003.

## Estado atual — após caveats Opus r2 — 2026-10-22

- Findings 1–5 e caveats 2–9 receberam revisões Luna limitadas aprovadas, incluindo o follow-up da rota `/api/zap-lead/events/stream` e o follow-up de propagação de erros do painel.
- Caveat 1 segue aberta: o Opus r2 não cobriu todo o working tree. Não há base para afirmar cobertura integral ou aprovação do conjunto.
- Próxima ação: entregar ao proprietário um prompt novo para Opus 5.5 fazer review read-only do estado integral atual; exigir inventário de todos os arquivos alterados e não rastreados, cobertura explícita por categoria e sinalização de qualquer arquivo não lido. Depois analisar o resultado e retomar só os itens encontrados.
- Parecer Opus r2 integral continua `REMEDIATION_REQUIRED`; task `in_progress`; H-DATA-003/H-DB-003 sem aprovação global.
- Limites: PostgreSQL descartável no Docker Desktop somente; sem Supabase, VPS, produção, tráfego/dados/credenciais reais, DB persistente, commit, push ou deploy.

## Próxima etapa — novo review integral do proprietário

Prompt atualizado preparado em `opus-5.5-review-prompt-after-remediation-20261022-r4.md`. Ele exige inventário atual de todos os arquivos alterados/não rastreados, cobertura por categoria, confronto de evidências e declaração explícita de qualquer caminho não lido. Task permanece `in_progress`; aguardar o proprietário executar o review Opus 5.5 read-only e enviar o resultado. Não inferir aprovação integral a partir dos reviews Luna limitados.
