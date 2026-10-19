import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ZapLeadAnalysisMatrixPanelView,
  resolveMatrixResultForFilters,
  resolveMatrixResultForPeriod,
  type ZapLeadAnalysisMatrixPanelViewProps,
} from './zap-lead-analysis-matrix';

const baseProps: ZapLeadAnalysisMatrixPanelViewProps = {
  state: 'loading',
  data: null,
};

function renderPanel(props: Partial<ZapLeadAnalysisMatrixPanelViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(ZapLeadAnalysisMatrixPanelView, { ...baseProps, ...props })
  );
}

describe('Zap Lead analysis matrix panel states', () => {
  it('hides a previous period matrix while the new period is loading', () => {
    const result = resolveMatrixResultForPeriod(
      {
        period: 30,
        state: 'ready',
        data: {
          status: 'ready',
          completedAt: '2026-10-14T12:00:00.000Z',
          totalAnalyzed: 2,
          matrix: [],
        },
      },
      7
    );

    expect(result).toEqual({ period: 7, state: 'loading', data: null });
  });

  it('hides a previous filter matrix while the next filter query loads', () => {
    const result = resolveMatrixResultForFilters(
      {
        period: 30,
        filterKey: 'seller-a\u0000campaign-a',
        state: 'ready',
        data: {
          status: 'ready',
          completedAt: '2026-10-14T12:00:00.000Z',
          totalAnalyzed: 2,
          matrix: [],
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

  it('renders loading, empty, pending, unavailable, and safe error states', () => {
    expect(renderPanel()).toContain('Carregando matriz de análise');
    expect(renderPanel({ state: 'empty' })).toContain(
      'Ainda não há análise concluída'
    );
    expect(renderPanel({ state: 'pending' })).toContain(
      'ainda está sendo preparada'
    );
    expect(renderPanel({ state: 'unavailable' })).toContain(
      'Nenhuma instalação do Zap Lead'
    );
    expect(renderPanel({ state: 'error' })).toContain(
      'Não foi possível carregar a matriz'
    );
    expect(renderPanel({ state: 'error' })).not.toContain(
      'secret upstream detail'
    );
  });

  it('renders only the aggregate lead and service score matrix', () => {
    const html = renderPanel({
      state: 'ready',
      data: {
        status: 'ready',
        completedAt: '2026-10-14T12:00:00.000Z',
        totalAnalyzed: 2,
        matrix: [
          {
            leadScore: 8,
            serviceScore: 7,
            count: 2,
            goodLeadCount: 1,
            percentage: 100,
          },
          {
            leadScore: 5,
            serviceScore: null,
            count: 1,
            goodLeadCount: 0,
            percentage: 50,
          },
        ],
      },
    });
    expect(html).toContain('Nota do lead');
    expect(html).toContain('Nota do atendimento');
    expect(html).toContain('8');
    expect(html).toContain('Sem nota');
    expect(html).toContain('100%');
  });
});
