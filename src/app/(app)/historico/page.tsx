import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Topbar } from '@/components/layout/topbar';
import { Badge, Card, CardContent, CategoryBadge, EmptyState } from '@/components/ui';
import { cn, formatDate, VISIT_STATUS_LABEL } from '@/lib/utils';
import { ClinicHistoryPanel } from './clinic-history-panel';

export const metadata = { title: 'Histórico' };
export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ clinic?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [visits, totals] = await Promise.all([
    prisma.visit.findMany({
      where: { userId: user.id, status: { in: ['COMPLETED', 'CANCELLED'] } },
      orderBy: [{ date: 'desc' }, { sequence: 'asc' }],
      take: 200,
      include: { clinic: true },
    }),
    prisma.visit.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: true,
      _sum: { veterinarians: true },
    }),
  ]);

  // Visitas contam veterinarios, nao paradas — uma clinica com 4 veterinarios
  // concluida vale 4 aqui, consistente com a meta mensal.
  const byStatus = Object.fromEntries(totals.map((t) => [t.status, t._sum.veterinarians ?? 0])) as Record<
    string,
    number
  >;

  const selectedClinic = params.clinic
    ? await prisma.clinic.findFirst({
        where: { id: params.clinic, organizationId: user.organizationId },
        include: {
          visits: {
            orderBy: { date: 'desc' },
            take: 30,
          },
        },
      })
    : null;

  // Agrupa por dia para leitura cronologica.
  const byDay = new Map<string, typeof visits>();
  for (const visit of visits) {
    const key = visit.date.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), visit]);
  }

  return (
    <>
      <Topbar
        title="Histórico"
        subtitle={`${byStatus.COMPLETED ?? 0} visitas realizadas · ${byStatus.CANCELLED ?? 0} canceladas`}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Card className="overflow-hidden">
            {visits.length === 0 ? (
              <EmptyState
                title="Nenhuma visita registrada ainda"
                description="Marque visitas como realizadas na agenda para construir o histórico."
              />
            ) : (
              <div className="divide-y divide-ink-100">
                {[...byDay.entries()].map(([day, dayVisits]) => (
                  <section key={day}>
                    <div className="sticky top-16 z-10 flex items-baseline justify-between bg-ink-50/95 px-5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold text-ink-700">{formatDate(day)}</p>
                      <p className="text-[11px] text-ink-400">
                        {dayVisits.filter((v) => v.status === 'COMPLETED').length} de {dayVisits.length} realizadas
                      </p>
                    </div>
                    <ul className="divide-y divide-ink-100">
                      {dayVisits.map((visit) => (
                        <li key={visit.id} className="flex items-center gap-3 px-5 py-2.5">
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              visit.status === 'COMPLETED'
                                ? 'bg-[var(--color-positive)]'
                                : 'bg-ink-300',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-ink-900">{visit.clinic.name}</p>
                            <p className="truncate text-[11px] text-ink-400">
                              {visit.clinic.neighborhood}
                              {visit.cancelledReason && ` · ${visit.cancelledReason}`}
                            </p>
                          </div>
                          <CategoryBadge category={visit.category} />
                          <Badge tone={visit.status === 'COMPLETED' ? 'positive' : 'neutral'}>
                            {VISIT_STATUS_LABEL[visit.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>

          <div className="lg:sticky lg:top-20 lg:self-start">
            {selectedClinic ? (
              <ClinicHistoryPanel
                clinic={{
                  id: selectedClinic.id,
                  name: selectedClinic.name,
                  category: selectedClinic.category,
                  neighborhood: selectedClinic.neighborhood,
                  city: selectedClinic.city,
                  address: selectedClinic.address,
                  phone: selectedClinic.phone,
                  lastVisitedAt: selectedClinic.lastVisitedAt?.toISOString() ?? null,
                }}
                visits={selectedClinic.visits.map((v) => ({
                  id: v.id,
                  date: v.date.toISOString().slice(0, 10),
                  status: v.status,
                  category: v.category,
                }))}
              />
            ) : (
              <Card>
                <CardContent>
                  <p className="text-xs font-semibold text-ink-800">Histórico por clínica</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                    Abra uma clínica pela Carteira para ver última visita, visita anterior, próxima
                    programada e todo o histórico dela.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
