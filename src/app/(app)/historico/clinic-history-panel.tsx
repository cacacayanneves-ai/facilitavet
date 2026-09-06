'use client';

import { Badge, Card, CardContent, CategoryBadge } from '@/components/ui';
import { cn, formatDate, VISIT_STATUS_LABEL } from '@/lib/utils';

/**
 * Historico da clinica (secao 38): ultima visita, visita anterior, proxima.
 * Esses tres campos sao o que o propagandista realmente consulta antes de
 * entrar numa clinica.
 */
export function ClinicHistoryPanel({
  clinic,
  visits,
}: {
  clinic: {
    id: string;
    name: string;
    category: string;
    neighborhood: string | null;
    city: string | null;
    address: string | null;
    phone: string | null;
    lastVisitedAt: string | null;
  };
  visits: Array<{ id: string; date: string; status: string; category: string }>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const completed = visits.filter((v) => v.status === 'COMPLETED').sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = visits
    .filter((v) => v.status === 'PLANNED' && v.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card className="animate-[rise_0.25s_ease-out]">
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink-900">{clinic.name}</p>
            <CategoryBadge category={clinic.category} />
          </div>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {[clinic.address, clinic.neighborhood, clinic.city].filter(Boolean).join(' · ')}
          </p>
          {clinic.phone && <p className="tabular mt-1 text-[11px] text-ink-500">{clinic.phone}</p>}
        </div>

        <dl className="space-y-2 rounded-lg bg-ink-50 px-3 py-2.5 text-[11px]">
          <Row label="Última visita" value={completed[0] ? formatDate(completed[0].date) : 'nunca visitada'} />
          <Row label="Visita anterior" value={completed[1] ? formatDate(completed[1].date) : '—'} />
          <Row
            label="Próxima programada"
            value={upcoming[0] ? formatDate(upcoming[0].date) : 'não agendada'}
            highlight={Boolean(upcoming[0])}
          />
          <Row label="Total realizadas" value={String(completed.length)} />
        </dl>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            Linha do tempo
          </p>
          {visits.length === 0 ? (
            <p className="text-[11px] text-ink-400">Nenhuma visita registrada.</p>
          ) : (
            <ol className="space-y-1.5">
              {visits.slice(0, 12).map((visit) => (
                <li key={visit.id} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      visit.status === 'COMPLETED'
                        ? 'bg-[var(--color-positive)]'
                        : visit.status === 'CANCELLED'
                          ? 'bg-ink-300'
                          : 'bg-brand-400',
                    )}
                  />
                  <span className="tabular w-20 text-ink-600">{formatDate(visit.date)}</span>
                  <Badge tone={visit.status === 'COMPLETED' ? 'positive' : visit.status === 'PLANNED' ? 'brand' : 'neutral'}>
                    {VISIT_STATUS_LABEL[visit.status]}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className={cn('tabular font-medium', highlight ? 'text-brand-700' : 'text-ink-800')}>{value}</dd>
    </div>
  );
}
