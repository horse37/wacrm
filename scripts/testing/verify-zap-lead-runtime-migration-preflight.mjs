import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString = process.env.WACRM_RUNTIME_PREFLIGHT_DATABASE_URL;
if (!connectionString) {
  throw new Error('WACRM_RUNTIME_PREFLIGHT_DATABASE_URL is required');
}

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/028_zap_lead_runtime_read_policies.sql',
    import.meta.url
  )
);
const migrationSql = await readFile(migrationPath, 'utf8');
const { Client } = pg;
const client = new Client({ connectionString });
const expectedMessage =
  'wacrm_runtime must be a non-privileged role without privileged memberships';

async function expectRejected(label, prepare, cleanup) {
  await prepare();
  try {
    await assert.rejects(client.query(migrationSql), (error) =>
      error.message.includes(expectedMessage)
    );
    console.log(`PASS: migration rejects ${label}`);
  } finally {
    await cleanup();
  }
}

await client.connect();
try {
  await expectRejected(
    'missing runtime role',
    () =>
      client.query(
        'ALTER ROLE wacrm_runtime RENAME TO wacrm_runtime_missing_test'
      ),
    () =>
      client.query(
        'ALTER ROLE wacrm_runtime_missing_test RENAME TO wacrm_runtime'
      )
  );
  await expectRejected(
    'SUPERUSER runtime role',
    () => client.query('ALTER ROLE wacrm_runtime SUPERUSER'),
    () => client.query('ALTER ROLE wacrm_runtime NOSUPERUSER')
  );
  await expectRejected(
    'BYPASSRLS runtime role',
    () => client.query('ALTER ROLE wacrm_runtime BYPASSRLS'),
    () => client.query('ALTER ROLE wacrm_runtime NOBYPASSRLS')
  );
  await expectRejected(
    'CREATEDB runtime role',
    () => client.query('ALTER ROLE wacrm_runtime CREATEDB'),
    () => client.query('ALTER ROLE wacrm_runtime NOCREATEDB')
  );
  await expectRejected(
    'CREATEROLE runtime role',
    () => client.query('ALTER ROLE wacrm_runtime CREATEROLE'),
    () => client.query('ALTER ROLE wacrm_runtime NOCREATEROLE')
  );

  await client.query(
    'CREATE ROLE wacrm_runtime_privileged_test NOLOGIN BYPASSRLS'
  );
  try {
    await expectRejected(
      'membership in a BYPASSRLS role',
      () =>
        client.query('GRANT wacrm_runtime_privileged_test TO wacrm_runtime'),
      () =>
        client.query('REVOKE wacrm_runtime_privileged_test FROM wacrm_runtime')
    );
  } finally {
    await client.query('DROP ROLE wacrm_runtime_privileged_test');
  }

  await expectRejected(
    'membership in the postgres policy and owner role',
    () => client.query('GRANT postgres TO wacrm_runtime'),
    () => client.query('REVOKE postgres FROM wacrm_runtime')
  );

  await client.query('CREATE ROLE wacrm_runtime_relation_owner_test NOLOGIN');
  await client.query(
    'GRANT CREATE ON SCHEMA public TO wacrm_runtime_relation_owner_test'
  );
  try {
    await client.query(
      'ALTER TABLE public.zap_lead_integrations OWNER TO wacrm_runtime_relation_owner_test'
    );
    await expectRejected(
      'membership in a protected relation owner role',
      () =>
        client.query(
          'GRANT wacrm_runtime_relation_owner_test TO wacrm_runtime'
        ),
      () =>
        client.query(
          'REVOKE wacrm_runtime_relation_owner_test FROM wacrm_runtime'
        )
    );
  } finally {
    await client.query(
      'ALTER TABLE public.zap_lead_integrations OWNER TO postgres'
    );
    await client.query(
      'REVOKE CREATE ON SCHEMA public FROM wacrm_runtime_relation_owner_test'
    );
    await client.query('DROP ROLE wacrm_runtime_relation_owner_test');
  }
} finally {
  await client.end();
}
