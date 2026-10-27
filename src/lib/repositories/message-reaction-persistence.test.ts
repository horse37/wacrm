import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import type { DbTransaction } from '../db/postgres-client';
import { createPostgresMessageReactionPersistenceRepository } from './message-reaction-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const messageA = '30000000-0000-4000-8000-000000000001';
const conversationA = '20000000-0000-4000-8000-000000000001';
const reactionA = '40000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  targetRows = [
    { conversationId: conversationA, providerMessageId: 'SYNTHETIC_META_ID' },
  ],
  upsertRows = [{ id: reactionA }],
  deletedRows = [],
}: {
  role?: string;
  targetRows?: Record<string, unknown>[];
  upsertRows?: Record<string, unknown>[];
  deletedRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.messages AS message')) {
        return { rows: targetRows, rowCount: targetRows.length };
      }
      if (sql.includes('INSERT INTO public.message_reactions AS reaction')) {
        return { rows: upsertRows, rowCount: upsertRows.length };
      }
      if (sql.includes('DELETE FROM public.message_reactions AS reaction')) {
        return { rows: deletedRows, rowCount: deletedRows.length };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  );
  const transaction = { query: transactionQuery } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return transactionQuery;
}

describe('PostgreSQL message-reaction persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a persistence transaction', async () => {
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => null
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies accounts below agent role before reading the message', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.messages AS message')
      )
    ).toBe(false);
  });

  it('validates the internal message UUID before issuing message SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.saveAgentReaction('../invalid-message-id', '👍')
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.messages AS message')
      )
    ).toBe(false);
  });

  it('returns not found for a missing or cross-account message', async () => {
    setupTransactions({ targetRows: [] });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('rejects a message without an external provider ID before persisting', async () => {
    const query = setupTransactions({
      targetRows: [{ conversationId: conversationA, providerMessageId: null }],
    });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.message_reactions AS reaction')
      )
    ).toBe(false);
  });

  it('upserts the current account member as an agent with bound values', async () => {
    const query = setupTransactions();
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).resolves.toBe(
      undefined
    );

    const target = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.messages AS message')
    );
    expect(target?.[0]).toContain('conversation.account_id = $2');
    expect(target?.[0]).toContain('conversation.account_id = $2');
    expect(target?.[1]).toEqual([messageA, accountA]);

    const upsert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.message_reactions AS reaction')
    );
    expect(upsert?.[0]).toContain(
      'ON CONFLICT (message_id, actor_type, actor_id)'
    );
    expect(upsert?.[0]).toContain("'agent'");
    expect(upsert?.[1]).toEqual([
      messageA,
      conversationA,
      sessionA.userId,
      '👍',
    ]);
    const identityIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('set_config')
    );
    const targetIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('FROM public.messages AS message')
    );
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(targetIndex).toBeGreaterThan(identityIndex);
  });

  it('deletes only the current actor agent reaction when emoji is empty', async () => {
    const query = setupTransactions({ deletedRows: [{ id: reactionA }] });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '')).resolves.toBe(
      undefined
    );

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.message_reactions AS reaction')
    );
    expect(deletion?.[0]).toContain('reaction.message_id = $1');
    expect(deletion?.[0]).toContain('reaction.conversation_id = $2');
    expect(deletion?.[0]).toContain("reaction.actor_type = 'agent'");
    expect(deletion?.[0]).toContain('reaction.actor_id = $3');
    expect(deletion?.[1]).toEqual([messageA, conversationA, sessionA.userId]);
  });

  it('treats deleting an absent actor reaction as an idempotent success', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '')).resolves.toBe(
      undefined
    );
  });

  it('fails closed if an upsert returns a malformed reaction ID', async () => {
    setupTransactions({ upsertRows: [{ id: 'not-a-uuid' }] });
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresMessageReactionPersistenceRepository(
      async () => sessionA
    );

    await expect(repository.saveAgentReaction(messageA, '👍')).rejects.toBe(
      databaseFailure
    );
  });
});
