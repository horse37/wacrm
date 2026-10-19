import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  listZapLeadLeads: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock('@/lib/zap-lead/leads', () => ({
  listZapLeadLeads: mocks.listZapLeadLeads,
}));

vi.mock('@/components/dashboard/zap-lead-lead-form', () => ({
  ZapLeadLeadForm: () => <form data-testid="zap-lead-lead-form" />,
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LeadsPage from './page';

describe('Zap Lead leads page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listZapLeadLeads.mockResolvedValue({ items: [], nextCursor: null });
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['agent', false],
    ['viewer', false],
  ] as const)('shows lead form for %s role: %s', async (role, expected) => {
    mocks.getCurrentAccount.mockResolvedValue({ role });

    const page = await LeadsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html.includes('data-testid="zap-lead-lead-form"')).toBe(expected);
  });
});
