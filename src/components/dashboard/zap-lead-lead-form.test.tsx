import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ZapLeadLeadForm } from './zap-lead-lead-form';

describe('Zap Lead lead form', () => {
  it('renders lead fields and explains that data stays in Zap Lead', () => {
    const html = renderToStaticMarkup(createElement(ZapLeadLeadForm));
    expect(html).toContain('Cadastrar lead');
    expect(html).toContain('Os dados são enviados ao Zap Lead');
    expect(html).toContain('name="contactName"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('pattern="\\+[1-9][0-9]{7,14}"');
    expect(html).toContain('name="campaignCode"');
    expect(html).not.toContain('name="initialMessage"');
  });
});
