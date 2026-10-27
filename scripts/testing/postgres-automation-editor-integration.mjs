import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationEditorRepository } from '../../src/lib/repositories/automation-editor.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const automationA = '30000000-0000-4000-8000-000000000001';
const automationB = '30000000-0000-4000-8000-000000000003';
const mismatchedCreatorAutomation = '30000000-0000-4000-8000-000000000002';
const emptyAutomation = '30000000-0000-4000-8000-000000000004';
const corruptTreeAutomation = '30000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

const repositoryFor = (userId) =>
  createPostgresAutomationEditorRepository(async () => ({ userId }));

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_automation_editor_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'profiles', 'automations', 'automation_steps']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    {
      relname: 'automation_steps',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    { relname: 'automations', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, column_name, privilege_type`
    ),
    'column grant probe'
  );
  assert.deepEqual(columnGrants.rows, [
    { table_name: 'accounts', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'accounts', column_name: 'name', privilege_type: 'SELECT' },
    {
      table_name: 'automation_steps',
      column_name: 'automation_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'branch',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'parent_step_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'position',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'step_config',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automation_steps',
      column_name: 'step_type',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'description',
      privilege_type: 'SELECT',
    },
    { table_name: 'automations', column_name: 'id', privilege_type: 'SELECT' },
    {
      table_name: 'automations',
      column_name: 'is_active',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'name',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'trigger_config',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'trigger_type',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'automations',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'account_role',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
  ]);

  const privilegeProbe = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automations', 'execution_count', 'SELECT') AS execution_count,
         has_column_privilege(current_user, 'public.automations', 'last_executed_at', 'SELECT') AS last_executed_at,
         has_column_privilege(current_user, 'public.profiles', 'full_name', 'SELECT') AS profile_name,
         has_column_privilege(current_user, 'public.automation_steps', 'created_at', 'SELECT') AS step_created_at,
         has_table_privilege(current_user, 'public.automations', 'INSERT') AS automation_insert,
         has_table_privilege(current_user, 'public.automation_steps', 'UPDATE') AS step_update,
         has_table_privilege(current_user, 'public.automation_steps', 'DELETE') AS step_delete`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    {
      execution_count: false,
      last_executed_at: false,
      profile_name: false,
      step_created_at: false,
      automation_insert: false,
      step_update: false,
      step_delete: false,
    },
  ]);

  const editorA = await repositoryFor(ownerA).getForAutomation(automationA);
  assert.deepEqual(editorA, {
    automation: {
      id: automationA,
      name: 'Editor A',
      description: null,
      trigger_type: 'new_message_received',
      trigger_config: {
        keywords: ['synthetic'],
        hook: 'https://synthetic.invalid/hook',
      },
      is_active: true,
    },
    steps: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
        branches: {
          yes: [
            {
              id: '40000000-0000-4000-8000-000000000003',
              step_type: 'add_tag',
              step_config: { tag_id: 'synthetic-tag' },
              branches: { yes: [], no: [] },
            },
            {
              id: '40000000-0000-4000-8000-000000000005',
              step_type: 'wait',
              step_config: { amount: 1, unit: 'minutes' },
              branches: { yes: [], no: [] },
            },
            {
              id: '40000000-0000-4000-8000-000000000006',
              step_type: 'send_message',
              step_config: { text: 'legacy yes branch' },
              branches: { yes: [], no: [] },
            },
          ],
          no: [
            {
              id: '40000000-0000-4000-8000-000000000004',
              step_type: 'send_message',
              step_config: { text: 'synthetic no branch' },
              branches: { yes: [], no: [] },
            },
          ],
        },
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        step_type: 'send_message',
        step_config: { text: 'synthetic root' },
        branches: { yes: [], no: [] },
      },
    ],
  });
  assert.deepEqual(Object.keys(editorA.automation).sort(), [
    'description',
    'id',
    'is_active',
    'name',
    'trigger_config',
    'trigger_type',
  ]);
  for (const nonCreator of [viewerA, agentA]) {
    await assert.rejects(
      repositoryFor(nonCreator).getForAutomation(automationA),
      (error) => error instanceof AppError && error.code === 'not_found'
    );
  }
  assert.deepEqual(await repositoryFor(ownerB).getForAutomation(automationB), {
    automation: {
      id: automationB,
      name: 'Editor B',
      description: 'Account B',
      trigger_type: 'keyword_match',
      trigger_config: {},
      is_active: false,
    },
    steps: [],
  });
  assert.deepEqual(
    await repositoryFor(ownerA).getForAutomation(emptyAutomation),
    {
      automation: {
        id: emptyAutomation,
        name: 'Empty editor',
        description: 'No steps',
        trigger_type: 'tag_added',
        trigger_config: {},
        is_active: false,
      },
      steps: [],
    }
  );

  for (const inaccessibleId of [automationB, mismatchedCreatorAutomation]) {
    await assert.rejects(
      repositoryFor(ownerA).getForAutomation(inaccessibleId),
      (error) => error instanceof AppError && error.code === 'not_found'
    );
  }
  await assert.rejects(
    repositoryFor(ownerA).getForAutomation(corruptTreeAutomation),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  await assert.rejects(
    createPostgresAutomationEditorRepository(async () => null).getForAutomation(
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
    await queryDb('SELECT count(*)::int AS count FROM public.automation_steps'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-editor integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, creator-only editor access with non-creator viewer/agent denial, account and creator isolation, deterministic nested step branches, legacy null branch compatibility, malformed cross-automation parent rejection, minimal editor DTO, empty automation, and pooled identity cleanup.'
  );
} finally {
  await pool.end();
}
