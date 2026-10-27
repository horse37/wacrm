import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { AppError } from '../db/errors';
import { acceptZapLeadWebhookReceipt } from './zap-lead-webhook-receipt';

const receipt = {
  accountId: '10000000-0000-4000-8000-000000000001',
  keyId: 'ak_aaaaaaaaaaaaaaaaaaaaaaaa',
  nonce: 'nonce-test-00000001',
  eventId: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
  eventType: 'lead.created',
  occurredAt: '2026-10-13T12:30:00.000Z',
};

describe('Zap Lead webhook receipt PostgreSQL repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rows: [{ status: 'accepted' }],
      rowCount: 1,
    });
    mocks.withTransaction.mockImplementation(async (operation) => ({
      ok: true,
      data: await operation({ query: mocks.query }),
    }));
  });

  it('calls the existing function with bound receipt values in a transaction', async () => {
    await expect(acceptZapLeadWebhookReceipt(receipt)).resolves.toBe(
      'accepted'
    );

    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT public\.accept_zap_lead_webhook_event\(\$1::uuid, \$2::text, \$3::text, \$4::uuid, \$5::text, \$6::timestamptz\)/
      ),
      [
        receipt.accountId,
        receipt.keyId,
        receipt.nonce,
        receipt.eventId,
        receipt.eventType,
        receipt.occurredAt,
      ]
    );
  });

  it.each(['accepted', 'duplicate', 'replay', 'invalid'] as const)(
    'preserves the %s function result',
    async (status) => {
      mocks.query.mockResolvedValueOnce({
        rows: [{ status }],
        rowCount: 1,
      });

      await expect(acceptZapLeadWebhookReceipt(receipt)).resolves.toBe(status);
    }
  );

  it('rejects missing or unknown function results', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(acceptZapLeadWebhookReceipt(receipt)).rejects.toThrow(
      'Zap Lead webhook receipt returned an invalid status'
    );

    mocks.query.mockResolvedValueOnce({
      rows: [{ status: 'unexpected' }],
      rowCount: 1,
    });

    await expect(acceptZapLeadWebhookReceipt(receipt)).rejects.toThrow(
      'Zap Lead webhook receipt returned an invalid status'
    );
  });

  it('returns a generic failure when PostgreSQL transaction fails', async () => {
    mocks.withTransaction.mockResolvedValueOnce({
      ok: false,
      error: new AppError('db_error'),
    });

    await expect(acceptZapLeadWebhookReceipt(receipt)).rejects.toThrow(
      'Could not persist Zap Lead webhook receipt'
    );
  });
});
