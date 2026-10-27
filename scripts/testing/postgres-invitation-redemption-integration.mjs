import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresInvitationRedemptionRepository } from '../../src/lib/repositories/invitation-redemption.ts';

const targetAccountId = '10000000-0000-4000-8000-000000000001';
const successCallerId = '00000000-0000-4000-8000-000000000003';
const domainTables = [
  'contacts',
  'conversations',
  'broadcasts',
  'automations',
  'flows',
  'pipelines',
  'message_templates',
  'tags',
  'custom_fields',
  'contact_notes',
  'whatsapp_config',
];
const domainTokenChars = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'f',
];

let activeUserId = successCallerId;
const pool = getPostgresPool();
const repository = createPostgresInvitationRedemptionRepository(async () =>
  activeUserId ? { userId: activeUserId } : null
);

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function expectAppError(promise, code, label) {
  const error = await promise.then(
    () => null,
    (reason) => reason
  );
  assert.ok(error instanceof AppError, `${label}: expected AppError`);
  assert.equal(error.code, code, `${label}: error code`);
  assert.equal(
    error.message,
    new AppError(code).message,
    `${label}: safe message`
  );
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT
         current_user AS role,
         rolbypassrls,
         has_table_privilege(current_user, 'public.accounts', 'SELECT') AS can_read_accounts,
         has_table_privilege(current_user, 'public.profiles', 'SELECT') AS can_read_profiles,
         has_table_privilege(current_user, 'public.account_invitations', 'SELECT') AS can_read_invitations,
         has_function_privilege(current_user, 'public.redeem_invitation(text)', 'EXECUTE') AS can_redeem
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_invitation_redemption_runtime',
      rolbypassrls: false,
      can_read_accounts: true,
      can_read_profiles: true,
      can_read_invitations: false,
      can_redeem: true,
    },
  ]);

  for (const table of domainTables) {
    const privileges = requireSuccess(
      await queryDb(
        `SELECT
           has_table_privilege(current_user, $1::text, 'SELECT') AS can_select,
           has_table_privilege(current_user, $1::text, 'INSERT') AS can_insert,
           has_table_privilege(current_user, $1::text, 'UPDATE') AS can_update,
           has_table_privilege(current_user, $1::text, 'DELETE') AS can_delete`,
        [`public.${table}`]
      ),
      `direct privilege probe for ${table}`
    );
    assert.deepEqual(privileges.rows, [
      {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ]);
  }

  activeUserId = null;
  await expectAppError(
    repository.redeemByTokenHash('a'.repeat(64)),
    'unauthorized',
    'missing verified session'
  );

  activeUserId = successCallerId;
  await expectAppError(
    repository.redeemByTokenHash('plaintext'),
    'not_found',
    'malformed digest'
  );

  const redeemedAccountId = await repository.redeemByTokenHash('A'.repeat(64));
  assert.equal(redeemedAccountId, targetAccountId);

  const movedProfile = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [successCallerId]
      );
      return transaction.query(
        `SELECT account_id::text AS account_id, account_role::text AS role
         FROM public.profiles
         WHERE user_id = $1`,
        [successCallerId]
      );
    }),
    'redeemed profile read'
  );
  assert.deepEqual(movedProfile.rows, [
    { account_id: targetAccountId, role: 'agent' },
  ]);

  await expectAppError(
    repository.redeemByTokenHash('A'.repeat(64)),
    'bad_request',
    'replayed invitation'
  );
  await expectAppError(
    repository.redeemByTokenHash('B'.repeat(64)),
    'bad_request',
    'expired invitation'
  );
  await expectAppError(
    repository.redeemByTokenHash('C'.repeat(64)),
    'bad_request',
    'used invitation'
  );
  await expectAppError(
    repository.redeemByTokenHash('0123456789abcdef'.repeat(4)),
    'bad_request',
    'unknown invitation'
  );

  activeUserId = '00000000-0000-4000-8000-000000000031';
  await expectAppError(
    repository.redeemByTokenHash('D'.repeat(64)),
    'conflict',
    'caller already belongs to invited account'
  );

  activeUserId = '00000000-0000-4000-8000-000000000004';
  await expectAppError(
    repository.redeemByTokenHash('E'.repeat(64)),
    'conflict',
    'caller is member of a shared account'
  );

  for (let index = 0; index < domainTables.length; index += 1) {
    activeUserId = `00000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}`;
    const tokenHash = domainTokenChars[index].repeat(64);
    await expectAppError(
      repository.redeemByTokenHash(tokenHash),
      'conflict',
      `domain-data guard for ${domainTables[index]}`
    );
  }

  activeUserId = '00000000-0000-4000-8000-000000000031';
  await expectAppError(
    repository.redeemByTokenHash('f'.repeat(63) + 'a'),
    'unauthorized',
    'SQLSTATE 42501 maps to unauthorized'
  );
  const identityState = requireSuccess(
    await queryDb(
      `SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NULL AS cleared`
    ),
    'transaction-local identity cleanup'
  );
  assert.deepEqual(identityState.rows, [{ cleared: true }]);

  console.log(
    'PostgreSQL invitation redemption integration SUCCESS: verified caller, hash-only bound RPC, success/replay/invalid/conflict/42501 mapping, all 11 domain-data guards, least-privilege runtime, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
