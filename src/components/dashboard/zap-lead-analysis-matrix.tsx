'use client';

import { useEffect, useState } from 'react';
import type { ZapLeadAnalysisMatrixData } from '@/lib/zap-lead/analysis-matrix';
import {
  appendZapLeadDashboardFilters,
  type ZapLeadDashboardFilters,
} from '@/lib/zap-lead/dashboard-filters';

type Period = 7 | 30 | 90;
type MatrixState =
  | 'loading'
  | 'unavailable'
  | 'empty'
  | 'pending'
  | 'ready'
  | 'error';

interface MatrixResult {
  period: Period;
  filterKey?: string;
  state: MatrixState;
  data: ZapLeadAnalysisMatrixData | null;
}

export function resolveMatrixResultForPeriod(
  result: MatrixResult,
  period: Period
): MatrixResult {
  return result.period === period
    ? result
    : { period, state: 'loading', data: null };
}

function filtersKey(filters: ZapLeadDashboardFilters): string {
  return `${filters.sellerId ?? ''}\u0000${filters.campaignCode ?? ''}`;
}

export function resolveMatrixResultForFilters(
  result: MatrixResult,
  period: Period,
  filters: ZapLeadDashboardFilters
): MatrixResult {
  const filterKey = filtersKey(filters);
  return result.period === period && result.filterKey === filterKey
    ? result
    : { period, filterKey, state: 'loading', data: null };
}

export interface ZapLeadAnalysisMatrixPanelViewProps {
  state: MatrixState;
  data: ZapLeadAnalysisMatrixData | null;
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
  }).format(value);
}

export function ZapLeadAnalysisMatrixPanel({
  period,
  filters,
}: {
  period: Period;
  filters: ZapLeadDashboardFilters;
}) {
  const currentFilterKey = filtersKey(filters);
  const [result, setResult] = useState<MatrixResult>({
    period,
    filterKey: currentFilterKey,
    state: 'loading',
    data: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ days: String(period) });
    appendZapLeadDashboardFilters(query, filters);
    void fetch(`/api/zap-lead/analysis-matrix?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return { kind: 'unavailable' as const };
        if (!response.ok)
          throw new Error('Zap Lead analysis matrix unavailable');
        return {
          kind: 'data' as const,
          data: (await response.json()) as ZapLeadAnalysisMatrixData,
        };
      })
      .then((response) => {
        if (response.kind === 'unavailable') {
          setResult({
            period,
            filterKey: currentFilterKey,
            state: 'unavailable',
            data: null,
          });
          return;
        }
        setResult({
          period,
          filterKey: currentFilterKey,
          state: response.data.status,
          data: response.data,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setResult({
          period,
          filterKey: currentFilterKey,
          state: 'error',
          data: null,
        });
      });
    return () => controller.abort();
  }, [period, filters, currentFilterKey]);

  return (
    <ZapLeadAnalysisMatrixPanelView
      {...resolveMatrixResultForFilters(result, period, filters)}
    />
  );
}

export function ZapLeadAnalysisMatrixPanelView({
  state,
  data,
}: ZapLeadAnalysisMatrixPanelViewProps) {
  return (
    <section className="border-border bg-card rounded-xl border p-5 shadow-sm">
      <h2 className="text-foreground text-lg font-semibold">
        Matriz lead × atendimento
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Distribuição da execução concluída mais recente no período selecionado.
      </p>

      {state === 'loading' && (
        <p className="text-muted-foreground mt-4 text-sm" role="status">
          Carregando matriz de análise…
        </p>
      )}
      {state === 'unavailable' && (
        <p className="text-muted-foreground mt-4 text-sm" role="status">
          Nenhuma instalação do Zap Lead está vinculada a esta conta.
        </p>
      )}
      {state === 'empty' && (
        <p className="text-muted-foreground mt-4 text-sm" role="status">
          Ainda não há análise concluída neste período.
        </p>
      )}
      {state === 'pending' && (
        <p className="text-muted-foreground mt-4 text-sm" role="status">
          A matriz desta análise ainda está sendo preparada.
        </p>
      )}
      {state === 'error' && (
        <p className="text-destructive mt-4 text-sm" role="alert">
          Não foi possível carregar a matriz de análise do Zap Lead.
        </p>
      )}
      {state === 'ready' && data && (
        <div className="mt-4 overflow-x-auto">
          <p className="text-muted-foreground mb-3 text-sm">
            {number(data.totalAnalyzed)} atendimentos analisados
          </p>
          {data.matrix.length === 0 ? (
            <p className="text-muted-foreground text-sm" role="status">
              A análise não retornou combinações para a matriz.
            </p>
          ) : (
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b">
                <tr>
                  <th className="px-3 py-2 font-medium">Nota do lead</th>
                  <th className="px-3 py-2 font-medium">Nota do atendimento</th>
                  <th className="px-3 py-2 font-medium">Atendimentos</th>
                  <th className="px-3 py-2 font-medium">Leads bons</th>
                  <th className="px-3 py-2 font-medium">Percentual</th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((cell, index) => (
                  <tr
                    className="border-border/70 border-b last:border-0"
                    key={`${cell.leadScore}-${cell.serviceScore}-${index}`}
                  >
                    <td className="px-3 py-2">{number(cell.leadScore)}</td>
                    <td className="px-3 py-2">
                      {cell.serviceScore === null
                        ? 'Sem nota'
                        : number(cell.serviceScore)}
                    </td>
                    <td className="px-3 py-2">{number(cell.count)}</td>
                    <td className="px-3 py-2">{number(cell.goodLeadCount)}</td>
                    <td className="px-3 py-2">{number(cell.percentage, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
