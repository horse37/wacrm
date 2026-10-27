export interface AutomationListItem {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
}

type AutomationListResponse = Pick<Response, 'ok' | 'json'>;
type AutomationListFetch = (
  input: string,
  init?: RequestInit
) => Promise<AutomationListResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAutomationListItem(value: unknown): value is AutomationListItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.description === null || typeof value.description === 'string') &&
    typeof value.trigger_type === 'string' &&
    typeof value.is_active === 'boolean' &&
    typeof value.execution_count === 'number' &&
    Number.isSafeInteger(value.execution_count) &&
    value.execution_count >= 0 &&
    (value.last_executed_at === null ||
      typeof value.last_executed_at === 'string')
  );
}

export async function fetchAutomationList(
  fetcher: AutomationListFetch = fetch
): Promise<AutomationListItem[]> {
  const response = await fetcher('/api/automations', {
    credentials: 'same-origin',
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      isRecord(body) &&
      typeof body.error === 'string' &&
      body.error.trim().length > 0
        ? body.error
        : 'Failed to load automations';
    throw new Error(message);
  }

  if (
    !isRecord(body) ||
    !Array.isArray(body.automations) ||
    !body.automations.every(isAutomationListItem)
  ) {
    throw new Error('Invalid automation list response');
  }

  return body.automations;
}
