import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getZapLeadLeadDetail, type ZapLeadDetail } from '@/lib/zap-lead/leads';

export const dynamic = 'force-dynamic';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : date.toLocaleString('pt-BR');
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  if (!z.uuid().safeParse(leadId).success) notFound();

  let lead: ZapLeadDetail | null;
  try {
    lead = await getZapLeadLeadDetail(leadId);
  } catch {
    return (
      <main className="space-y-6 p-6">
        <Link
          className="text-sm underline-offset-4 hover:underline"
          href="/leads"
        >
          Voltar aos leads
        </Link>
        <p role="alert" className="text-destructive text-sm">
          Não foi possível carregar este lead agora. Tente novamente em alguns
          minutos.
        </p>
      </main>
    );
  }

  if (!lead) {
    return (
      <main className="space-y-6 p-6">
        <Link
          className="text-sm underline-offset-4 hover:underline"
          href="/leads"
        >
          Voltar aos leads
        </Link>
        <p className="text-muted-foreground text-sm">
          Configure a integração Zap Lead da conta para consultar os leads.
        </p>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-6">
      <Link
        className="text-sm underline-offset-4 hover:underline"
        href="/leads"
      >
        Voltar aos leads
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {lead.name || 'Lead sem nome'}
        </h1>
        <p className="text-muted-foreground text-sm">
          Dados consultados diretamente no Zap Lead e não persistidos nesta
          conta.
        </p>
      </header>

      <section
        aria-labelledby="lead-details-heading"
        className="rounded-lg border p-5"
      >
        <h2 id="lead-details-heading" className="text-lg font-medium">
          Dados do lead
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-sm">Telefone</dt>
            <dd className="mt-1">{lead.phone || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">E-mail</dt>
            <dd className="mt-1">{lead.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Etapa</dt>
            <dd className="mt-1">{lead.stage?.name ?? 'Sem etapa'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Origem</dt>
            <dd className="mt-1">{lead.source || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Campanha</dt>
            <dd className="mt-1">{lead.campaignCode ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Criado em</dt>
            <dd className="mt-1">{formatDate(lead.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Atualizado em</dt>
            <dd className="mt-1">{formatDate(lead.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
