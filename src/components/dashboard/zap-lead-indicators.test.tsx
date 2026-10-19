import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ZapLeadIndicatorsPanelView,
  resolveIndicatorResultForFilters,
  type ZapLeadIndicatorsPanelViewProps,
} from './zap-lead-indicators';

const baseProps: ZapLeadIndicatorsPanelViewProps = {
  period: 30,
  state: 'loading',
  data: null,
  onPeriodChange: vi.fn(),
};

function renderPanel(props: Partial<ZapLeadIndicatorsPanelViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(ZapLeadIndicatorsPanelView, { ...baseProps, ...props })
  );
}

describe('Zap Lead indicators panel states', () => {
  it('renders loading and unavailable states', () => {
    expect(renderPanel()).toContain('Carregando indicadores');
    expect(renderPanel({ state: 'unavailable' })).toContain(
      'Nenhuma instalação do Zap Lead está vinculada a esta conta.'
    );
  });

  it('renders a generic error without upstream details', () => {
    const html = renderPanel({ state: 'error' });
    expect(html).toContain(
      'Não foi possível carregar os indicadores do Zap Lead.'
    );
    expect(html).not.toContain('secret upstream detail');
  });

  it('renders validated aggregate metrics and the period selector', () => {
    const html = renderPanel({
      state: 'ready',
      data: {
        period: {
          from: '2026-10-08T00:00:00.000Z',
          to: '2026-10-14T23:59:59.999Z',
        },
        items: [
          { key: 'leads_created', value: 12, unit: 'count' },
          { key: 'first_response_seconds_avg', value: 84.2, unit: 'seconds' },
          { key: 'responded_within_5m', value: 75, unit: 'percent' },
        ],
      },
    });

    expect(html).toContain('aria-label="Período dos indicadores do Zap Lead"');
    expect(html).toContain('Leads recebidos');
    expect(html).toContain('12');
    expect(html).toContain('84,2 s');
    expect(html).toContain('75%');
  });

  it('exposes account-scoped seller and campaign filter controls', () => {
    const html = renderPanel();
    expect(html).toContain('ID do vendedor no Zap Lead');
    expect(html).toContain('Código da campanha no Zap Lead');
    expect(html).toContain('Aplicar filtros');
  });

  it('hides indicators from the previous filters while the next query loads', () => {
    const result = resolveIndicatorResultForFilters(
      {
        period: 30,
        filterKey: 'seller-a\u0000campaign-a',
        state: 'ready',
        data: {
          period: {
            from: '2026-09-15T00:00:00.000Z',
            to: '2026-10-14T23:59:59.999Z',
          },
          items: [{ key: 'leads_created', value: 12, unit: 'count' }],
        },
      },
      30,
      { sellerId: 'seller-b', campaignCode: 'campaign-b' }
    );

    expect(result).toEqual({
      period: 30,
      filterKey: 'seller-b\u0000campaign-b',
      state: 'loading',
      data: null,
    });
  });
});
