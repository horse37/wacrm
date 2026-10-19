import Link from 'next/link';
import { ZapLeadLeadForm } from '@/components/dashboard/zap-lead-lead-form';
import { getCurrentAccount } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { listZapLeadLeads, type ZapLeadPage } from '@/lib/zap-lead/leads';

export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : date.toLocaleDateString('pt-BR');
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const account = await getCurrentAccount();
  const canCreateLead = hasMinRole(account.role, 'admin');
  const params = await searchParams;
  let page: ZapLeadPage | null;
  try {
    page = await listZapLeadLeads({
      limit: PAGE_LIMIT,
      ...(typeof params.cursor === 'string' ? { cursor: params.cursor } : {}),
    });
  } catch {
    return (
      <main className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Leads do Zap Lead</h1>
        <p role="alert" className="text-destructive text-sm">
          Não foi possível carregar os leads agora. Tente novamente em alguns
          minutos.
        </p>
        {canCreateLead ? <ZapLeadLeadForm /> : null}
      </main>
    );
  }

  if (!page) {
    return (
      <main className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Leads do Zap Lead</h1>
        <p className="text-muted-foreground text-sm">
          Configure a integração Zap Lead da conta para consultar os leads.
        </p>
        {canCreateLead ? <ZapLeadLeadForm /> : null}
      </main>
    );
  }

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Leads do Zap Lead</h1>
        <p className="text-muted-foreground text-sm">
          Consulta ao vivo dos leads da conta. Os dados permanecem no Zap Lead.
        </p>
      </header>

      {canCreateLead ? <ZapLeadLeadForm /> : null}

      {page.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum lead encontrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Telefone</th>
                <th className="px-4 py-3 font-medium">Etapa</th>
                <th className="px-4 py-3 font-medium">Criado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((lead) => (
                <tr key={lead.id}>
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/leads/${lead.id}`}
                    >
                      {lead.name || 'Lead sem nome'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{lead.phone || '—'}</td>
                  <td className="px-4 py-3">
                    {lead.stage?.name ?? 'Sem etapa'}
                  </td>
                  <td className="px-4 py-3">{formatDate(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page.nextCursor ? (
        <nav aria-label="Paginação dos leads">
          <Link
            className="hover:bg-muted inline-flex rounded-md border px-4 py-2 text-sm font-medium"
            href={{ pathname: '/leads', query: { cursor: page.nextCursor } }}
          >
            Próxima página
          </Link>
        </nav>
      ) : null}
    </main>
  );
}
