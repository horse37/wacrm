import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresInvitationPreviewRepository } from '../../src/lib/repositories/invitation-preview.ts';

const openHash = 'a'.repeat(64);
const expiredHash = 'b'.repeat(64);
const usedHash = 'c'.repeat(64);
const unknownHash = 'd'.repeat(64);
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT
         current_user AS role,
         rolbypassrls,
         has_table_privilege(current_user, 'public.accounts', 'SELECT') AS can_read_accounts,
         has_table_privilege(current_user, 'public.account_invitations', 'SELECT') AS can_read_invitations
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_invitation_preview_runtime',
      rolbypassrls: false,
      can_read_accounts: false,
      can_read_invitations: false,
    },
  ]);

  const repository = createPostgresInvitationPreviewRepository();
  const open = await repository.peekByTokenHash(openHash);
  assert.equal(open.ok, true);
  if (!open.ok) throw new Error('Expected an active preview.');
  assert.equal(open.account_name, 'Synthetic Invitation Account');
  assert.equal(open.role, 'agent');
  assert.ok(Number.isFinite(Date.parse(open.expires_at)));
  assert.deepEqual(Object.keys(open).sort(), [
    'account_name',
    'expires_at',
    'ok',
    'role',
  ]);

  assert.deepEqual(await repository.peekByTokenHash(expiredHash), {
    ok: false,
    reason: 'expired',
  });
  assert.deepEqual(await repository.peekByTokenHash(usedHash), {
    ok: false,
    reason: 'used',
  });
  assert.deepEqual(await repository.peekByTokenHash(unknownHash), {
    ok: false,
    reason: 'not_found',
  });
  assert.deepEqual(await repository.peekByTokenHash('plaintext'), {
    ok: false,
    reason: 'not_found',
  });

  console.log(
    'PostgreSQL invitation preview integration SUCCESS: bound hash lookup, fixed success shape, used/expired/not-found reasons, SECURITY DEFINER read without table grants, and malformed hash rejection.'
  );
} finally {
  await pool.end();
}
