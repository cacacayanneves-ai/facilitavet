'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Check, Map as MapIcon, Navigation, Sun } from 'lucide-react';
import { Badge, Button, Card, CardContent, CategoryBadge } from '@/components/ui';
import type { SerializedRoute } from '@/components/route/types';
import { cn, formatDateLong, formatDuration, formatKm, formatTime } from '@/lib/utils';

/**
 * Painel "Hoje" (secao 36).
 *
 * A primeira coisa que o usuario ve. Responde a pergunta operacional do dia —
 * "para onde eu vou agora?" — e permite marcar a visita como realizada sem sair
 * do dashboard. Em campo, cada toque a menos conta.
 */
export function TodayPanel({
  route,
  today,
  nextRoute,
}: {
  route: SerializedRoute | null;
  today: string;
  /** Proxima jornada planejada, usada quando hoje nao e dia util. */
  nextRoute?: SerializedRoute | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Em fim de semana ou feriado o painel nao fica vazio: mostra a proxima
  // jornada, que e a informacao que o usuario realmente quer nesse momento.
  const isToday = Boolean(route && route.stops.length > 0);
  const active = isToday ? route! : nextRoute ?? null;

  if (!active || active.stops.length === 0) {
    return (
      <Card className="border-brand-200 bg-gradient-to-br from-brand-50 to-surface">
        <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-brand-600 shadow-[var(--shadow-subtle)]">
              <Sun className="size-4.5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">Nenhuma visita programada</p>
              <p className="text-xs text-ink-500">
                Hoje não é um dia útil da sua agenda e não há jornada planejada à frente.
              </p>
            </div>
          </div>
          <Link href="/agenda">
            <Button variant="outline" size="sm">Ver agenda</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const done = active.stops.filter((s) => s.status === 'COMPLETED').length;
  const next = active.stops.find((s) => s.status === 'PLANNED' || s.status === 'IN_PROGRESS');

  async function markCompleted(visitId: string) {
    setBusyId(visitId);
    await fetch(`/api/visits/${visitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    setBusyId(null);
    router.refresh();
  }

  void today;

  return (
    <Card className="overflow-hidden border-brand-200/80">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-surface px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-[var(--color-on-brand)]">
            <Sun className="size-4" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {isToday ? 'Hoje' : `Próxima jornada · ${formatDateLong(active.date)}`} ·{' '}
              {active.stops.length} visita{active.stops.length > 1 ? 's' : ''}
            </p>
            <p className="text-[11px] text-ink-500">
              {active.regionLabel && <>{active.regionLabel} · </>}
              {formatKm(active.totalDistanceMeters)} · {formatDuration(active.totalDurationSeconds)}
              {done > 0 && <> · {done} concluída{done > 1 ? 's' : ''}</>}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Link href={`/agenda/${active.date}`}>
            <Button size="sm" variant="outline">Abrir roteiro</Button>
          </Link>
          <Link href={`/mapa?date=${active.date}`}>
            <Button size="sm" variant="secondary">
              <MapIcon className="size-3.5" />
              Mapa
            </Button>
          </Link>
        </div>
      </div>

      <CardContent className="!p-0">
        <ol className="divide-y divide-ink-100">
          {active.stops.map((stop) => {
            const isNext = next?.id === stop.id;
            const completed = stop.status === 'COMPLETED';
            const cancelled = stop.status === 'CANCELLED';

            return (
              <li
                key={stop.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-3 transition-colors',
                  isNext && 'bg-accent-50/60',
                  cancelled && 'opacity-55',
                )}
              >
                <span
                  className={cn(
                    'tabular flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
                    completed
                      ? 'bg-[var(--color-positive-soft)] text-[var(--color-positive-text)]'
                      : isNext
                        ? 'bg-accent-600 text-[var(--color-on-brand)]'
                        : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {completed ? <Check className="size-3.5 animate-[check_0.4s_ease-out]" strokeWidth={3} /> : stop.sequence}
                </span>

                <span className="tabular w-11 shrink-0 text-xs font-medium text-ink-600">
                  {formatTime(stop.estimatedArrival)}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-sm font-medium text-ink-900',
                      (completed || cancelled) && 'line-through decoration-ink-300',
                    )}
                  >
                    {stop.clinicName}
                  </p>
                  <p className="truncate text-[11px] text-ink-400">
                    {stop.neighborhood}
                    {stop.distanceFromPreviousMeters > 0 && (
                      <> · +{formatKm(stop.distanceFromPreviousMeters, 1)}</>
                    )}
                  </p>
                </div>

                <div className="hidden sm:block">
                  <CategoryBadge category={stop.category} />
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {stop.lat !== null && stop.lng !== null && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex size-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-700"
                      title="Navegar até aqui"
                    >
                      <Navigation className="size-4" strokeWidth={1.75} />
                    </a>
                  )}
                  {!completed && !cancelled && stop.visitId && (
                    <Button
                      size="sm"
                      variant={isNext ? 'primary' : 'ghost'}
                      loading={busyId === stop.visitId}
                      onClick={() => markCompleted(stop.visitId!)}
                    >
                      {busyId !== stop.visitId && <Check className="size-3.5" strokeWidth={2.5} />}
                      <span className="hidden sm:inline">Realizada</span>
                    </Button>
                  )}
                  {cancelled && <Badge tone="neutral">Cancelada</Badge>}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
