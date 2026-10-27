import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createDefaultPostgresAccountGuards } from '@/lib/auth/postgres-account-guard';
import { getPostgresPool } from '@/lib/db/postgres-pool';
import { createPostgresTemplateDeletePersistenceRepository } from '@/lib/repositories/template-delete-persistence';
import { createPostgresTemplateLifecycleConfigRepository } from '@/lib/repositories/template-lifecycle-config';
import { createPostgresTemplateLifecycleContextRepository } from '@/lib/repositories/template-lifecycle-context';

const enabled = process.env.WACRM_TEMPLATE_DELETE_POSTGRES_TEST === '1';
const databaseName = 'wacrm_template_delete_task';
const ids = {
  accountA: '00000000-0000-4000-8000-000000000001',
  accountB: '00000000-0000-4000-8000-000000000002',
  adminA: '00000000-0000-4000-8000-000000000011',
  attendantB: '00000000-0000-4000-8000-000000000022',
  templateA: '00000000-0000-4000-8000-000000000031',
  templateB: '00000000-0000-4000-8000-000000000032',
} as const;

describe.skipIf(!enabled)('PostgreSQL template DELETE repositories', () => {
  let pool: ReturnType<typeof getPostgresPool> | null = null;
  let ownsFixtures = false;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error('DATABASE_URL is required for this test.');

    const databaseUrl = new URL(connectionString);
    if (
      !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
      databaseUrl.hostname !== 'wacrm-template-postgres' ||
      databaseUrl.pathname !== `/${databaseName}`
    ) {
      throw new Error(
        `Refusing non-disposable target ${databaseUrl.hostname}${databaseUrl.pathname}.`
      );
    }

    pool = getPostgresPool();
    const existingTables = await pool.query<{ relation: string | null }>(
      `SELECT to_regclass('public.accounts')::text AS relation
       UNION ALL SELECT to_regclass('public.profiles')::text
       UNION ALL SELECT to_regclass('public.message_templates')::text
       UNION ALL SELECT to_regclass('public.whatsapp_config')::text`
    );
    if (existingTables.rows.some((row) => row.relation !== null)) {
      throw new Error('Refusing database with pre-existing fixture tables.');
    }

    ownsFixtures = true;
    await pool.query(`CREATE TABLE public.accounts (
         id uuid PRIMARY KEY,
         name text NOT NULL
       )`);
    await pool.query(`CREATE TABLE public.profiles (
         user_id uuid PRIMARY KEY,
         account_id uuid NOT NULL REFERENCES public.accounts (id),
         account_role text NOT NULL
       )`);
    await pool.query(`CREATE TABLE public.message_templates (
         id uuid PRIMARY KEY,
         account_id uuid NOT NULL REFERENCES public.accounts (id),
         user_id uuid NOT NULL REFERENCES public.profiles (user_id),
         name text NOT NULL,
         meta_template_id text,
         status text NOT NULL
       )`);
    await pool.query(`CREATE TABLE public.whatsapp_config (
         account_id uuid PRIMARY KEY REFERENCES public.accounts (id),
         access_token text NOT NULL,
         waba_id text
       )`);
    await pool.query('INSERT INTO public.accounts (id, name) VALUES ($1, $2)', [
      ids.accountA,
      'Synthetic account A',
    ]);
    await pool.query('INSERT INTO public.accounts (id, name) VALUES ($1, $2)', [
      ids.accountB,
      'Synthetic account B',
    ]);
    await pool.query(
      'INSERT INTO public.profiles (user_id, account_id, account_role) VALUES ($1, $2, $3)',
      [ids.adminA, ids.accountA, 'admin']
    );
    await pool.query(
      'INSERT INTO public.profiles (user_id, account_id, account_role) VALUES ($1, $2, $3)',
      [ids.attendantB, ids.accountB, 'attendant']
    );
    await pool.query(
      `INSERT INTO public.message_templates
         (id, account_id, user_id, name, meta_template_id, status)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [
        ids.templateA,
        ids.accountA,
        ids.adminA,
        'Synthetic template A',
        'approved',
      ]
    );
    await pool.query(
      `INSERT INTO public.message_templates
         (id, account_id, user_id, name, meta_template_id, status)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [
        ids.templateB,
        ids.accountB,
        ids.attendantB,
        'Synthetic template B',
        'approved',
      ]
    );
    await pool.query(
      `INSERT INTO public.whatsapp_config (account_id, access_token, waba_id)
       VALUES ($1, $2, $3)`,
      [ids.accountA, 'synthetic-encrypted-token', 'synthetic-waba']
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (ownsFixtures) {
        await pool.query(
          `DROP TABLE IF EXISTS public.message_templates,
             public.whatsapp_config,
             public.profiles,
             public.accounts`
        );
      }
    } finally {
      await pool.end();
    }
  });

  it('reads only the verified account template and its WhatsApp config', async () => {
    const getVerifiedSession = async () => ({ userId: ids.adminA });
    const contextRepository =
      createPostgresTemplateLifecycleContextRepository(getVerifiedSession);
    const configRepository =
      createPostgresTemplateLifecycleConfigRepository(getVerifiedSession);
    const accountGuards =
      createDefaultPostgresAccountGuards(getVerifiedSession);

    await expect(accountGuards.requireRole('admin')).resolves.toMatchObject({
      accountId: ids.accountA,
    });
    await expect(
      contextRepository.getForDelete(ids.templateA)
    ).resolves.toMatchObject({
      name: 'Synthetic template A',
      metaTemplateId: null,
    });
    await expect(
      contextRepository.getForDelete(ids.templateB)
    ).resolves.toBeNull();
    await expect(configRepository.getForDelete()).resolves.toMatchObject({
      encryptedAccessToken: 'synthetic-encrypted-token',
      wabaId: 'synthetic-waba',
    });
  });

  it('keeps delete authorization in the transaction and scopes deletion by account', async () => {
    const adminRepository = createPostgresTemplateDeletePersistenceRepository(
      async () => ({ userId: ids.adminA })
    );
    const attendantRepository =
      createPostgresTemplateDeletePersistenceRepository(async () => ({
        userId: ids.attendantB,
      }));

    await expect(
      attendantRepository.deleteTemplate(ids.templateB)
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      adminRepository.deleteTemplate(ids.templateB)
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      adminRepository.deleteTemplate(ids.templateA)
    ).resolves.toBeUndefined();

    const remainingTemplates = await pool!.query<{ id: string }>(
      'SELECT id::text AS id FROM public.message_templates ORDER BY id'
    );
    expect(remainingTemplates.rows).toEqual([{ id: ids.templateB }]);
  });
});
