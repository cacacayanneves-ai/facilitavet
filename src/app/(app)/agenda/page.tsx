import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildWorkCalendar, fromDateKey, monthRange, toDateKey } from '@/lib/services/calendar';
import { Topbar } from '@/components/layout/topbar';
import { Badge, Card, CardContent, EmptyState } from '@/components/ui';
import { cn, formatDuration, formatKm, monthName, todayKey } from '@/lib/utils';

export const metadata = { title: 'Agenda' };
export const dynamic = 'force-dynamic';

/**
 * CALENDARIO MENSAL (secao 35).
 *
 * Cada dia mostra visitas, km, tempo e regiao — a informacao que faz o usuario
 * decidir se abre aquele dia ou nao, sem precisar clicar em cada um.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const user = await requireUser();
  const settings = user.settings!;
  const params = await searchParams;

  const now = new Date();
  const year = Number.parseInt(params.year ?? '', 10) || now.getUTCFullYear();
  const month = Number.parseInt(params.month ?? '', 10) || now.getUTCMonth() + 1;
  const { start, end } = monthRange(year, month);

  const [calendar, routes] = await Promise.all([
    buildWorkCalendar({
      userId: user.id,
      organizationId: user.organizationId,
      year,
      month,
      workDays: settings.workDays,
      country: settings.country,
      state: settings.state,
      city: settings.city,
    }),
    prisma.route.findMany({
      where: { date: { gte: start, lte: end }, monthlyPlan: { userId: user.id } },
      include: {
        _count: { select: { stops: true } },
        stops: { select: { visit: { select: { status: true } } } },
      },
      orderBy: { date: 'asc' },
    }),
  ]);

  const routeByDate = new Map(routes.map((r) => [toDateKey(r.date), r]));
  const today = todayKey();
  const leadingBlanks = calendar.length ? fromDateKey(calendar[0].date).getUTCDay() : 0;

  const totals = routes.reduce(
    (acc, r) => ({
      visits: acc.visits + r._count.stops,
      distance: acc.distance + r.totalDistanceMeters,
      duration: acc.duration + r.totalDurationSeconds,
    }),
    { visits: 0, distance: 0, duration: 0 },
  );

  const prev = year * 12 + (month - 1) - 1;
  const next = year * 12 + (month - 1) + 1;

  return (
    <>
      <Topbar
        title="Agenda"
        subtitle={
          routes.length > 0
            ? `${totals.visits} visitas · ${formatKm(totals.distance)} · ${formatDuration(totals.duration)}`
            : 'Nenhum dia planejado neste mês'
        }
      />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1">
          <Link
            href={`/agenda?year=${Math.floor(prev / 12)}&month=${(prev % 12) + 1}`}
            className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h2 className="min-w-44 text-center text-lg font-semibold capitalize tracking-tight text-ink-900">
            {monthName(month)} {year}
          </h2>
          <Link
            href={`/agenda?year=${Math.floor(next / 12)}&month=${(next % 12) + 1}`}
            className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>

        {routes.length === 0 ? (
          <Card>
            <EmptyState
              title={`${monthName(month)} ainda não tem roteiro`}
              description="Gere o planejamento do mês para ver a agenda dia a dia."
              action={
                <Link
                  href={`/planejamento?year=${year}&month=${month}`}
                  className="inline-flex h-9 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-[var(--color-on-brand)] transition-colors hover:bg-brand-800"
                >
                  Criar roteiro
                </Link>
              }
            />
          </Card>
        ) : null}

        {/* Grade do mes */}
        <div className="grid grid-cols-7 gap-2">
          {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((label) => (
            <div key={label} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.slice(0, 3)}</span>
            </div>
          ))}

          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}

          {calendar.map((day) => {
            const route = routeByDate.get(day.date);
            const isToday = day.date === today;
            const completed = route?.stops.filter((s) => s.visit?.status === 'COMPLETED').length ?? 0;

            const content = (
              <div
                className={cn(
                  'flex h-full min-h-24 flex-col rounded-xl border p-2 transition-all duration-150 sm:min-h-28',
                  route
                    ? 'border-ink-200 bg-surface shadow-[var(--shadow-subtle)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]'
                    : day.available
                      ? 'border-dashed border-ink-300 bg-surface/50'
                      : 'border-ink-200 bg-ink-100/60',
                  isToday && 'ring-2 ring-brand-500 ring-offset-1',
                )}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={cn(
                      'tabular text-xs font-semibold',
                      route ? 'text-ink-900' : day.available ? 'text-ink-600' : 'text-ink-300',
                    )}
                  >
                    {Number(day.date.slice(8, 10))}
                  </span>
                  {day.reason === 'HOLIDAY' && (
                    <span className="size-1.5 rounded-full bg-[var(--color-warning)]" title={day.holidayName} />
                  )}
                  {day.reason === 'BLOCKED' && (
                    <span className="size-1.5 rounded-full bg-[var(--color-danger)]" title="Dia bloqueado" />
                  )}
                </div>

                {route ? (
                  <div className="mt-auto space-y-0.5">
                    <p className="text-[11px] font-semibold text-ink-900">
                      {route._count.stops} visita{route._count.stops > 1 ? 's' : ''}
                    </p>
                    <p className="tabular text-[10px] text-ink-500">
                      {formatKm(route.totalDistanceMeters)} · {formatDuration(route.totalDurationSeconds)}
                    </p>
                    <p className="truncate text-[10px] text-ink-400" title={route.regionLabel ?? ''}>
                      {route.regionLabel}
                    </p>
                    {completed > 0 && (
                      <div className="pt-0.5">
                        <Badge tone="positive">
                          {completed}/{route._count.stops}
                        </Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-auto text-[10px] text-ink-400">
                    {day.reason === 'HOLIDAY'
                      ? day.holidayName
                      : day.reason === 'BLOCKED'
                        ? 'Bloqueado'
                        : day.available
                          ? 'Sem visitas'
                          : ''}
                  </p>
                )}
              </div>
            );

            return route ? (
              <Link key={day.date} href={`/agenda/${day.date}`} className="block">
                {content}
              </Link>
            ) : (
              <div key={day.date}>{content}</div>
            );
          })}
        </div>
      </main>
    </>
  );
}
