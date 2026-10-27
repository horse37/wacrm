import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  createFlowRunListRepository: vi.fn(),
  listForFlow: vi.fn(),
  createFlowRunEventListRepository: vi.fn(),
  listEventsForFlow: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/repositories/flow-run-list', () => ({
  createPostgresFlowRunListRepository: mocks.createFlowRunListRepository,
}));
vi.mock('@/lib/repositories/flow-run-event-list', () => ({
  createPostgresFlowRunEventListRepository:
    mocks.createFlowRunEventListRepository,
}));

import { GET } from './route';

const userId = '22222222-2222-4222-8222-222222222222';
const flowId = '11111111-1111-4111-8111-111111111111';
const runId = '33333333-3333-4333-8333-333333333333';
const runHistory = {
  flow: { id: flowId, name: 'Synthetic flow' },
  runs: [
    {
      id: runId,
      status: 'completed',
      current_node_key: null,
      started_at: '2026-10-20T12:00:00.000Z',
      last_advanced_at: '2026-10-20T12:00:01.000Z',
      ended_at: '2026-10-20T12:00:02.000Z',
      end_reason: 'completed',
      vars: {},
      reprompt_count: 0,
      contact: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Synthetic contact',
        phone: '+15555550123',
      },
    },
  ],
};
const eventHistory = [
  {
    flow_run_id: runId,
    event_type: 'started',
    node_key: null,
    payload: {},
    created_at: '2026-10-20T12:00:00.000Z',
  },
];

async function getRunHistory() {
  return GET(new Request(`http://localhost/api/flows/${flowId}/runs`), {
    params: Promise.resolve({ id: flowId }),
  });
}

describe('GET /api/flows/[id]/runs', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset().mockImplementation((table: string) => {
      const legacyQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: flowId, name: 'Legacy flow' },
        }),
        order: vi.fn(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      legacyQuery.select.mockReturnValue(legacyQuery);
      legacyQuery.eq.mockReturnValue(legacyQuery);
      legacyQuery.in.mockReturnValue(legacyQuery);
      legacyQuery.order.mockImplementation(() =>
        table === 'flow_run_events'
          ? Promise.resolve({ data: [] })
          : legacyQuery
      );
      return legacyQuery;
    });
    mocks.createFlowRunListRepository.mockReset().mockReturnValue({
      listForFlow: mocks.listForFlow,
    });
    mocks.listForFlow.mockReset().mockResolvedValue(runHistory);
    mocks.createFlowRunEventListRepository.mockReset().mockReturnValue({
      listForFlow: mocks.listEventsForFlow,
    });
    mocks.listEventsForFlow.mockReset().mockResolvedValue(eventHistory);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await getRunHistory();

    expect(response.status).toBe(401);
    expect(mocks.createFlowRunListRepository).not.toHaveBeenCalled();
    expect(mocks.createFlowRunEventListRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
  });

  it('loads flow, runs, and events from PostgreSQL using verified identity', async () => {
    const response = await getRunHistory();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...runHistory,
      events: eventHistory,
    });
    expect(mocks.createFlowRunListRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createFlowRunEventListRepository).toHaveBeenCalledTimes(1);
    const [getRunSession] = mocks.createFlowRunListRepository.mock.calls[0];
    const [getEventSession] =
      mocks.createFlowRunEventListRepository.mock.calls[0];
    await expect(getRunSession()).resolves.toEqual({ userId });
    await expect(getEventSession()).resolves.toEqual({ userId });
    expect(mocks.listForFlow).toHaveBeenCalledTimes(1);
    expect(mocks.listForFlow).toHaveBeenCalledWith(flowId);
    expect(mocks.listEventsForFlow).toHaveBeenCalledTimes(1);
    expect(mocks.listEventsForFlow).toHaveBeenCalledWith(flowId);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'The requested resource was not found.'],
    ['db_error', 500, 'The database operation failed.'],
  ] as const)(
    'maps run repository %s errors to safe HTTP status and message',
    async (code, status, message) => {
      mocks.listForFlow.mockRejectedValueOnce(new AppError(code));

      const response = await getRunHistory();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.listEventsForFlow).not.toHaveBeenCalled();
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    }
  );

  it('does not load event timelines when no runs exist', async () => {
    mocks.listForFlow.mockResolvedValueOnce({ ...runHistory, runs: [] });

    const response = await getRunHistory();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      flow: runHistory.flow,
      runs: [],
      events: [],
    });
    expect(mocks.createFlowRunEventListRepository).not.toHaveBeenCalled();
    expect(mocks.listEventsForFlow).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
  });

  it('keeps the run history when PostgreSQL event loading fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.listEventsForFlow.mockRejectedValueOnce(
      new Error('synthetic private SQL detail')
    );

    const response = await getRunHistory();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...runHistory, events: [] });
    expect(consoleError).toHaveBeenCalledWith(
      '[flows-runs] events fetch failed:',
      'The database operation failed.'
    );
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
  });
});
