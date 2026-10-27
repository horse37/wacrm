import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogsRepository } from '../../src/lib/repositories/automation-logs.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const automationA = '30000000-0000-4000-8000-000000000001';
const formerMemberAutomation = '30000000-0000-4000-8000-000000000003';
const automationB = '30000000-0000-4000-8000-000000000002';
const automationC = '30000000-0000-4000-8000-000000000004';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresAutomationLogsRepository(async () => ({ userId }));
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls,
              has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS can_insert_logs,
              has_table_privilege(current_user, 'public.automation_logs', 'UPDATE') AS can_update_logs,
              has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS can_delete_logs,
              has_column_privilege(current_user, 'public.automations', 'trigger_config', 'SELECT') AS can_read_trigger_config,
              has_column_privilege(current_user, 'public.contacts', 'email', 'SELECT') AS can_read_contact_email,
              has_column_privilege(current_user, 'public.contacts', 'company', 'SELECT') AS can_read_contact_company
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role and privilege probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_automation_logs_runtime',
      rolbypassrls: false,
      can_insert_logs: false,
      can_update_logs: false,
      can_delete_logs: false,
      can_read_trigger_config: false,
      can_read_contact_email: false,
      can_read_contact_company: false,
    },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, column_name, privilege_type`
    ),
    'runtime column grant probe'
  );
  assert.deepEqual(
    grants.rows.map(({ table_name, column_name, privilege_type }) => [
      table_name,
      column_name,
      privilege_type,
    ]),
    [
      ['accounts', 'id', 'SELECT'],
      ['accounts', 'name', 'SELECT'],
      ['automation_logs', 'account_id', 'SELECT'],
      ['automation_logs', 'automation_id', 'SELECT'],
      ['automation_logs', 'contact_id', 'SELECT'],
      ['automation_logs', 'created_at', 'SELECT'],
      ['automation_logs', 'error_message', 'SELECT'],
      ['automation_logs', 'id', 'SELECT'],
      ['automation_logs', 'status', 'SELECT'],
      ['automation_logs', 'steps_executed', 'SELECT'],
      ['automation_logs', 'trigger_event', 'SELECT'],
      ['automation_logs', 'user_id', 'SELECT'],
      ['automations', 'account_id', 'SELECT'],
      ['automations', 'id', 'SELECT'],
      ['automations', 'name', 'SELECT'],
      ['automations', 'user_id', 'SELECT'],
      ['contacts', 'account_id', 'SELECT'],
      ['contacts', 'id', 'SELECT'],
      ['contacts', 'name', 'SELECT'],
      ['contacts', 'phone', 'SELECT'],
      ['profiles', 'account_id', 'SELECT'],
      ['profiles', 'account_role', 'SELECT'],
      ['profiles', 'user_id', 'SELECT'],
    ]
  );

  const listA = await repositoryFor(ownerA).listForAutomation(automationA);
  assert.equal(listA.automation.id, automationA);
  assert.equal(listA.automation.name, 'Synthetic automation A');
  assert.equal(listA.logs.length, 100);
  assert.deepEqual(
    listA.logs.slice(0, 3).map((log) => log.id),
    [
      '40000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
    ]
  );
  assert.equal(listA.logs.at(-1).id, '45000000-0000-4000-8000-000000000005');
  assert.deepEqual(listA.logs[0], {
    id: '40000000-0000-4000-8000-000000000002',
    trigger_event: 'keyword_match',
    steps_executed: [],
    status: 'failed',
    error_message: 'Synthetic failure',
    created_at: '2026-10-20T10:00:00.000Z',
    contact: null,
  });
  assert.deepEqual(listA.logs[1], {
    id: '40000000-0000-4000-8000-000000000001',
    trigger_event: 'new_message_received',
    steps_executed: [
      {
        step_type: 'send_message',
        status: 'success',
        detail: 'Synthetic delivery',
      },
      { step_type: 'condition', status: 'skipped' },
    ],
    status: 'partial',
    error_message: null,
    created_at: '2026-10-20T10:00:00.000Z',
    contact: { name: 'Synthetic Contact A', phone: '+15555550123' },
  });
  assert.equal(listA.logs[2].contact, null);
  assert.deepEqual(Object.keys(listA.automation).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(listA.logs[1]).sort(), [
    'contact',
    'created_at',
    'error_message',
    'id',
    'status',
    'steps_executed',
    'trigger_event',
  ]);
  assert.deepEqual(Object.keys(listA.logs[1].steps_executed[0]).sort(), [
    'detail',
    'status',
    'step_type',
  ]);
  assert.equal(
    JSON.stringify(listA).includes('SYNTHETIC_AUTOMATION_CONFIG_MUST_NOT_LEAK'),
    false
  );

  assert.deepEqual(
    await repositoryFor(viewerA).listForAutomation(automationA),
    listA
  );
  assert.deepEqual(
    await repositoryFor(agentA).listForAutomation(automationA),
    listA
  );
  const listB = await repositoryFor(ownerB).listForAutomation(automationB);
  assert.deepEqual(
    listB.logs.map((log) => log.id),
    ['40000000-0000-4000-8000-000000000005']
  );
  const listC = await repositoryFor(adminC).listForAutomation(automationC);
  assert.deepEqual(listC.logs, []);

  await assert.rejects(
    repositoryFor(ownerA).listForAutomation(automationB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  const formerMemberList = await repositoryFor(ownerA).listForAutomation(
    formerMemberAutomation
  );
  assert.equal(formerMemberList.automation.name, 'Former member automation');
  assert.deepEqual(
    formerMemberList.logs.map((log) => log.id),
    ['40000000-0000-4000-8000-000000000004']
  );
  await assert.rejects(
    repositoryFor(ownerB).listForAutomation(formerMemberAutomation),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(ownerA).listForAutomation('invalid'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    createPostgresAutomationLogsRepository(async () => null).listForAutomation(
      automationA
    ),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.automation_logs'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-log-list integration SUCCESS: forced RLS, NOBYPASSRLS, creator-moved account resource retention, cross-account isolation, column-minimal SELECT grants, owner/agent/viewer access, 100-row limit, deterministic UTC ordering, minimal log/step/contact DTO, empty history, fail-closed requests, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
