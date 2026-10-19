import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ createLead: vi.fn() }));

vi.mock('@/lib/zap-lead/leads', () => ({
  createZapLeadLeadForCurrentAccount: mocks.createLead,
}));

function request(body: unknown, idempotencyKey = 'submit-001') {
  return new Request('http://localhost/api/zap-lead/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('Zap Lead lead creation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLead.mockResolvedValue('11111111-1111-4111-8111-111111111111');
  });

  it('forwards the form and idempotency key, returning no lead data', async () => {
    const response = await POST(
      request({ contactName: 'Contato Fictício', phone: '+5511999990101' })
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ created: true });
    expect(mocks.createLead).toHaveBeenCalledWith(
      { contactName: 'Contato Fictício', phone: '+5511999990101' },
      'submit-001'
    );
  });

  it('requires JSON and an idempotency key', async () => {
    const noType = new Request('http://localhost/api/zap-lead/leads', {
      method: 'POST',
      body: '{}',
    });
    expect((await POST(noType)).status).toBe(400);
    expect(
      (
        await POST(
          new Request('http://localhost/api/zap-lead/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and maps unavailable integration', async () => {
    const malformed = new Request('http://localhost/api/zap-lead/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'submit-002',
      },
      body: '{',
    });
    expect((await POST(malformed)).status).toBe(400);

    const oversized = new Request('http://localhost/api/zap-lead/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'submit-large',
      },
      body: JSON.stringify({ value: 'x'.repeat(9_000) }),
    });
    expect((await POST(oversized)).status).toBe(413);

    mocks.createLead.mockResolvedValueOnce(null);
    const missing = await POST(
      request({ contactName: 'Contato', phone: '+5511999990101' })
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'zap_lead_not_configured' });
  });

  it('preserves account authorization errors and hides upstream details', async () => {
    mocks.createLead.mockRejectedValueOnce(new UnauthorizedError());
    expect(
      (await POST(request({ contactName: 'Contato', phone: '+5511999990101' })))
        .status
    ).toBe(401);
    mocks.createLead.mockRejectedValueOnce(new ForbiddenError());
    expect(
      (await POST(request({ contactName: 'Contato', phone: '+5511999990101' })))
        .status
    ).toBe(403);
    mocks.createLead.mockRejectedValueOnce(new Error('private upstream data'));
    const failed = await POST(
      request({ contactName: 'Contato', phone: '+5511999990101' })
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'zap_lead_unavailable' });
  });
});
