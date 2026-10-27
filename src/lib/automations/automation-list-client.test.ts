import { describe, expect, it, vi } from 'vitest';

import { fetchAutomationList } from './automation-list-client';

const listedAutomations = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Synthetic automation',
    description: null,
    trigger_type: 'new_message_received',
    is_active: true,
    execution_count: 2,
    last_executed_at: '2026-10-20T10:00:00.000Z',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchAutomationList', () => {
  it('loads the existing card DTO from the same-origin API', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ automations: listedAutomations }));

    await expect(fetchAutomationList(fetcher)).resolves.toEqual(
      listedAutomations
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/automations', {
      credentials: 'same-origin',
    });
  });

  it('uses the safe API error message for non-success responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'Authentication is required.' }, 401)
      );

    await expect(fetchAutomationList(fetcher)).rejects.toThrow(
      'Authentication is required.'
    );
  });

  it('uses a generic message when an error response is not JSON', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('not json', { status: 500 }));

    await expect(fetchAutomationList(fetcher)).rejects.toThrow(
      'Failed to load automations'
    );
  });

  it.each([
    ['null item', { automations: [null] }],
    [
      'invalid card field',
      { automations: [{ ...listedAutomations[0], is_active: 'yes' }] },
    ],
  ])(
    'rejects a malformed successful response with %s',
    async (_label, body) => {
      const fetcher = vi.fn().mockResolvedValue(jsonResponse(body));

      await expect(fetchAutomationList(fetcher)).rejects.toThrow(
        'Invalid automation list response'
      );
    }
  );
});
