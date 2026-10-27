import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { createPostgresWhatsAppSendFlowRunRepository } from './whatsapp-send-flow-run';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const contactId = '40000000-0000-4000-8000-000000000001';
const flowRunId = '70000000-0000-4000-8000-000000000001';
const endedAt = '2026-10-21T10:00:00.000Z';

describe('PostgreSQL WhatsApp send flow-run repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockResolvedValue({ rows: [] });
    mocks.withTransaction.mockImplementation(async (operation) => {
      try {
        const transaction = { query: mocks.transactionQuery };
        return { ok: true, data: await operation(transaction) };
      } catch (error) {
        return { ok: false, error };
      }
    });
  });

  it('pauses the active run for the verified account and contact', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT id::text AS id')) {
        return { rows: [{ id: flowRunId }] };
      }
      return typeof sql === 'string' && sql.includes('UPDATE public.flow_runs')
        ? { rows: [{ id: flowRunId }] }
        : { rows: [] };
    });
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply(contactId, endedAt)
    ).resolves.toBe(true);

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT id::text AS id'),
      [accountId, contactId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE public.flow_runs'),
      [accountId, contactId, endedAt]
    );
  });

  it('returns false when no active run exists', async () => {
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply(contactId, endedAt)
    ).resolves.toBe(false);
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(2);
    expect(mocks.transactionQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.flow_runs'),
      expect.any(Array)
    );
  });

  it('fails closed when RLS filters an active run from the UPDATE', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT id::text AS id')) {
        return { rows: [{ id: flowRunId }] };
      }
      return { rows: [] };
    });
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply(contactId, endedAt)
    ).rejects.toMatchObject({ code: 'db_error' });
  });

  it('does not query PostgreSQL for invalid UUIDs or timestamps', async () => {
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply('not-a-uuid', endedAt)
    ).resolves.toBe(false);
    await expect(
      repository.pauseActiveForAgentReply(contactId, 'not-a-timestamp')
    ).resolves.toBe(false);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when PostgreSQL returns more than one active run', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('SELECT id::text AS id')
        ? {
            rows: [
              { id: flowRunId },
              { id: '70000000-0000-4000-8000-000000000002' },
            ],
          }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply(contactId, endedAt)
    ).rejects.toMatchObject({ code: 'db_error' });
  });

  it('propagates database failures to the route best-effort boundary', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT id::text AS id')) {
        return { rows: [{ id: flowRunId }] };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE public.flow_runs')) {
        throw new Error('synthetic database failure');
      }
      return { rows: [] };
    });
    const repository = createPostgresWhatsAppSendFlowRunRepository({
      userId,
      accountId,
    });

    await expect(
      repository.pauseActiveForAgentReply(contactId, endedAt)
    ).rejects.toThrow('synthetic database failure');
  });
});
