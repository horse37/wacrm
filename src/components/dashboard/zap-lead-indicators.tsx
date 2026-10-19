'use client';

import { useEffect, useState } from 'react';
import type {
  ZapLeadIndicatorKey,
  ZapLeadIndicatorsData,
} from '@/lib/zap-lead/indicators';
import {
  appendZapLeadDashboardFilters,
  type ZapLeadDashboardFilters,
} from '@/lib/zap-lead/dashboard-filters';
import { ZapLeadAnalysisMatrixPanel } from './zap-lead-analysis-matrix';

type Period = 7 | 30 | 90;
type PanelState = 'loading' | 'ready' | 'unavailable' | 'error';
interface PanelResult {
  period: Period;
  filterKey: string;
  state: PanelState;
  data: ZapLeadIndicatorsData | null;
}

export interface ZapLeadIndicatorsPanelViewProps {
  period: Period;
  state: PanelState;
  data: ZapLeadIndicatorsData | null;
  onPeriodChange: (period: Period) => void;
  sellerId?: string;
  campaignCode?: string;
  onSellerIdChange?: (value: string) => void;
  onCampaignCodeChange?: (value: string) => void;
  onApplyFilters?: () => void;
}

function filtersKey(filters: ZapLeadDashboardFilters): string {
  return `${filters.sellerId ?? ''}\u0000${filters.campaignCode ?? ''}`;
}

export function resolveIndicatorResultForFilters(
  result: PanelResult,
  period: Period,
  filters: ZapLeadDashboardFilters
): PanelResult {
  return result.period === period && result.filterKey === filtersKey(filters)
    ? result
    : { period, filterKey: filtersKey(filters), state: 'loading', data: null };
}

const labels: Record<ZapLeadIndicatorKey, string> = {
  leads_created: 'Leads recebidos',
  first_response_seconds_avg: 'Tempo médio da primeira resposta',
  responded_within_5m: 'Respondidos em até 5 minutos',
  responded_within_15m: 'Respondidos em até 15 minutos',
  responded_within_60m: 'Respondidos em até 60 minutos',
  leads_without_response: 'Leads sem resposta',
  follow_ups: 'Follow-ups',
  deadline_expired: 'Prazos estourados',
  abandoned_conversations: 'Conversas abandonadas',
};

function formatValue(value: number, unit: 'count' | 'seconds' | 'percent') {
  const formatted = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: unit === 'seconds' ? 1 : 0,
  }).format(value);
  if (unit === 'seconds') return `${formatted} s`;
  if (unit === 'percent') return `${formatted}%`;
  return formatted;
}

export function ZapLeadIndicatorsPanel() {
  const [period, setPeriod] = useState<Period>(30);
  const [sellerId, setSellerId] = useState('');
  const [campaignCode, setCampaignCode] = useState('');
  const [filters, setFilters] = useState<ZapLeadDashboardFilters>({});
  const currentFilterKey = filtersKey(filters);
  const [result, setResult] = useState<PanelResult>({
    period: 30,
    filterKey: currentFilterKey,
    state: 'loading',
    data: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ days: String(period) });
    appendZapLeadDashboardFilters(query, filters);
    void fetch(`/api/zap-lead/indicators?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return { kind: 'unavailable' as const };
        if (!response.ok) throw new Error('Zap Lead indicators unavailable');
        return {
          kind: 'data' as const,
          data: (await response.json()) as ZapLeadIndicatorsData,
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
          state: 'ready',
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

  const panelResult = resolveIndicatorResultForFilters(result, period, filters);
  const onApplyFilters = () => {
    setFilters({
      ...(sellerId.trim() ? { sellerId: sellerId.trim() } : {}),
      ...(campaignCode.trim() ? { campaignCode: campaignCode.trim() } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <ZapLeadIndicatorsPanelView
        data={panelResult.data}
        onApplyFilters={onApplyFilters}
        onCampaignCodeChange={setCampaignCode}
        onPeriodChange={setPeriod}
        onSellerIdChange={setSellerId}
        period={period}
        sellerId={sellerId}
        campaignCode={campaignCode}
        state={panelResult.state}
      />
      <ZapLeadAnalysisMatrixPanel filters={filters} period={period} />
    </div>
  );
}

export function ZapLeadIndicatorsPanelView({
  period,
  state,
  data,
  onPeriodChange,
  sellerId = '',
  campaignCode = '',
  onSellerIdChange,
  onCampaignCodeChange,
  onApplyFilters,
}: ZapLeadIndicatorsPanelViewProps) {
  return (
    <section className="border-border bg-card rounded-xl border p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            Indicadores do Zap Lead
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Dados agregados da instalação vinculada a esta conta.
          </p>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Período
          <select
            aria-label="Período dos indicadores do Zap Lead"
            className="border-border bg-background text-foreground rounded-md border px-2 py-1.5"
            value={period}
            onChange={(event) =>
              onPeriodChange(Number(event.target.value) as Period)
            }
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </label>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyFilters?.();
        }}
      >
        <label className="text-muted-foreground flex flex-col gap-1 text-sm">
          ID do vendedor
          <input
            aria-label="ID do vendedor no Zap Lead"
            className="border-border bg-background text-foreground rounded-md border px-3 py-2"
            onChange={(event) => onSellerIdChange?.(event.target.value)}
            placeholder="UUID do vendedor"
            value={sellerId}
          />
        </label>
        <label className="text-muted-foreground flex flex-col gap-1 text-sm">
          Código da campanha
          <input
            aria-label="Código da campanha no Zap Lead"
            className="border-border bg-background text-foreground rounded-md border px-3 py-2"
            maxLength={80}
            onChange={(event) => onCampaignCodeChange?.(event.target.value)}
            placeholder="Ex.: LANCTO-TESTE"
            value={campaignCode}
          />
        </label>
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          type="submit"
        >
          Aplicar filtros
        </button>
      </form>

      {state === 'loading' && (
        <p className="text-muted-foreground mt-5 text-sm" role="status">
          Carregando indicadores…
        </p>
      )}
      {state === 'unavailable' && (
        <p className="text-muted-foreground mt-5 text-sm" role="status">
          Nenhuma instalação do Zap Lead está vinculada a esta conta.
        </p>
      )}
      {state === 'error' && (
        <p className="text-destructive mt-5 text-sm" role="alert">
          Não foi possível carregar os indicadores do Zap Lead.
        </p>
      )}
      {state === 'ready' && data && (
        <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <div
              className="border-border/70 bg-background rounded-lg border p-4"
              key={item.key}
            >
              <dt className="text-muted-foreground text-sm">
                {labels[item.key]}
              </dt>
              <dd className="text-foreground mt-2 text-2xl font-semibold">
                {formatValue(item.value, item.unit)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
