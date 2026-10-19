import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getReadClient: vi.fn(),
  getWriteClient: vi.fn(),
  get: vi.fn(),
  createLead: vi.fn(),
}));

vi.mock('./credentials', () => ({
  getZapLeadReadClientForCurrentAccount: mocks.getReadClient,
  getZapLeadWriteClientForCurrentAccount: mocks.getWriteClient,
}));

import {
  createZapLeadLeadForCurrentAccount,
  getZapLeadLeadDetail,
  listZapLeadLeads,
} from './leads';

const lead = {
  id: '11111111-1111-4111-8111-111111111111',
  contactId: '22222222-2222-4222-8222-222222222222',
  name: 'Contato Fictício',
  phone: '+5511999990101',
  stage: null,
  sellerId: null,
  departmentId: null,
  campaignCode: null,
  source: 'direct',
  createdAt: '2026-10-14T12:00:00.000Z',
  updatedAt: '2026-10-14T12:00:00.000Z',
};

describe('Zap Lead lead reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReadClient.mockResolvedValue({ get: mocks.get });
    mocks.getWriteClient.mockResolvedValue({ createLead: mocks.createLead });
  });

  it('requests a paginated lead page through the read-only client', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ at: '2026-10-14T12:00:00.000Z', id: lead.id })
    ).toString('base64url');
    const page = { items: [lead], nextCursor: 'cursor-next' };
    mocks.get.mockResolvedValue({ apiVersion: '1', data: page });

    await expect(listZapLeadLeads({ limit: 25, cursor })).resolves.toEqual(
      page
    );

    expect(mocks.get).toHaveBeenCalledWith(
`/api/agency/v1/leads?limit=25&cursor=${cursor}`
    );
  });

  it('requests one lead by UUID and returns only the API payload', async () => {
    const detail = { ...lead, email: null };
    mocks.get.mockResolvedValue({ apiVersion: '1', data: detail });

    await expect(getZapLeadLeadDetail(lead.id)).resolves.toEqual(detail);

expect(mocks.get).toHaveBeenCalledWith(`/api/agency/v1/leads/${lead.id}`);
  });

  it('rejects an invalid lead ID before making a remote request', async () => {
    await expect(getZapLeadLeadDetail('not-a-uuid')).rejects.toThrow();
    expect(mocks.getReadClient).not.toHaveBeenCalled();
  });

  it('rejects invalid pagination parameters before making a remote request', async () => {
    await expect(listZapLeadLeads({ limit: 101 })).rejects.toThrow();
    await expect(
      listZapLeadLeads({ cursor: 'a'.repeat(513) })
    ).rejects.toThrow();
    await expect(
      listZapLeadLeads({ cursor: 'malformed cursor' })
    ).rejects.toThrow();
    await expect(listZapLeadLeads({ cursor: 'bm90LWpzb24' })).rejects.toThrow();
    const invalidShapeCursor = Buffer.from(
      JSON.stringify({ at: '2026-10-14T12:00:00.000Z', id: 'not-a-uuid' })
    ).toString('base64url');
    await expect(
      listZapLeadLeads({ cursor: invalidShapeCursor })
    ).rejects.toThrow();
    expect(mocks.getReadClient).not.toHaveBeenCalled();
  });

  it('returns null when this account has no Zap Lead integration', async () => {
    mocks.getReadClient.mockResolvedValue(null);

    await expect(listZapLeadLeads({})).resolves.toBeNull();
  });

  it('creates a lead through the write client with fixed agency source', async () => {
    mocks.createLead.mockResolvedValue({
      apiVersion: '1',
      data: { ...lead, email: null },
    });
    await expect(
      createZapLeadLeadForCurrentAccount(
        { contactName: '  Contato Fictício  ', phone: '+5511999990101' },
        '  form-submit-001  '
      )
    ).resolves.toBe(lead.id);
    expect(mocks.createLead).toHaveBeenCalledWith(
      {
        contactName: 'Contato Fictício',
        phone: '+5511999990101',
        source: 'wacrm_form',
      },
      'form-submit-001'
    );
  });

  it('rejects invalid form data and idempotency keys before requesting a client', async () => {
    await expect(
      createZapLeadLeadForCurrentAccount(
        { contactName: 'Contato', phone: '11999990101' },
        'form-submit-001'
      )
    ).rejects.toThrow();
    await expect(
      createZapLeadLeadForCurrentAccount(
        { contactName: 'Contato', phone: '+5511999990101' },
        'invalid key'
      )
    ).rejects.toThrow();
    expect(mocks.getWriteClient).not.toHaveBeenCalled();
  });

  it('returns null when this account has no write integration', async () => {
    mocks.getWriteClient.mockResolvedValue(null);
    await expect(
      createZapLeadLeadForCurrentAccount(
        { contactName: 'Contato Fictício', phone: '+5511999990101' },
        'form-submit-002'
      )
    ).resolves.toBeNull();
    expect(mocks.createLead).not.toHaveBeenCalled();
  });
});
