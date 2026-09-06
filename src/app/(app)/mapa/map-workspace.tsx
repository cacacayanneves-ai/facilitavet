'use client';

import Link from 'next/link';
import * as React from 'react';
import { CalendarDays, Layers } from 'lucide-react';
import { Badge, Button, Card, CardContent, Switch } from '@/components/ui';
import { GoogleRouteMap } from '@/components/map/google-route-map';
import { RouteMap } from '@/components/map/route-map';
import type { SerializedRoute } from '@/components/route/types';
import { cn, formatDate, formatDuration, formatKm, formatNumber, formatTime } from '@/lib/utils';

interface ClinicPoint {
  id: string;
  name: string;
  neighborhood: string | null;
  category: string;
  lat: number;
  lng: number;
}

export function MapWorkspace({
  routes,
  initialDate,
  clinics,
  browserMapsKey,
}: {
  routes: SerializedRoute[];
  initialDate: string;
  clinics: ClinicPoint[];
  browserMapsKey: string;
}) {
  const [selectedDate, setSelectedDate] = React.useState(initialDate);
  const [showContext, setShowContext] = React.useState(true);
  const [showAllRoutes, setShowAllRoutes] = React.useState(false);
  const [selectedStop, setSelectedStop] = React.useState<string | null>(null);

  const route = routes.find((r) => r.date === selectedDate) ?? routes[0];

  // "Mes inteiro": todas as paradas viram pontos coloridos por categoria, sem
  // linha de rota — a linha ligando 21 dias diferentes seria ruido puro.
  const mapStops = React.useMemo(() => {
    const source = showAllRoutes ? routes.flatMap((r) => r.stops) : route.stops;
    return source
      .filter((s) => s.lat !== null && s.lng !== null)
      .map((s) => ({
        id: s.id,
        lat: s.lat!,
        lng: s.lng!,
        label: s.clinicName,
        sublabel: s.neighborhood,
        sequence: showAllRoutes ? undefined : s.sequence,
        category: s.category,
        status: s.status,
      }));
  }, [showAllRoutes, route, routes]);

  const context = showContext ? clinics.map((c) => ({ lat: c.lat, lng: c.lng })) : [];
  const MapComponent = browserMapsKey ? GoogleRouteMap : RouteMap;

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      {/* Lista de dias */}
      <div className="space-y-3 lg:order-1">
        <Card>
          <CardContent className="space-y-3 !py-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-800">
              <Layers className="size-3.5 text-ink-400" />
              Camadas
            </div>
            <Switch
              checked={showContext}
              onChange={setShowContext}
              label="Carteira completa"
              description="Todas as clínicas como contexto"
            />
            <Switch
              checked={showAllRoutes}
              onChange={setShowAllRoutes}
              label="Mês inteiro"
              description="Todas as visitas planejadas do mês"
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-2.5 text-xs font-semibold text-ink-800">
            <CalendarDays className="size-3.5 text-ink-400" />
            Dias planejados
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {routes.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedDate(item.date);
                  setShowAllRoutes(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-ink-100 px-4 py-2.5 text-left transition-colors last:border-0',
                  item.date === selectedDate && !showAllRoutes
                    ? 'bg-brand-50'
                    : 'hover:bg-ink-50',
                )}
              >
                <span
                  className={cn(
                    'tabular flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                    item.date === selectedDate && !showAllRoutes
                      ? 'bg-brand-600 text-[var(--color-on-brand)]'
                      : 'bg-ink-100 text-ink-600',
                  )}
                >
                  {Number(item.date.slice(8, 10))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink-800">
                    {item.stops.length} visitas
                  </p>
                  <p className="truncate text-[10px] text-ink-400">{item.regionLabel}</p>
                </div>
                <span className="tabular shrink-0 text-[10px] text-ink-500">
                  {formatKm(item.totalDistanceMeters)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Mapa */}
      <div className="space-y-4 lg:order-2">
        <MapComponent
          apiKey={browserMapsKey}
          stops={mapStops}
          origin={showAllRoutes ? null : route.origin}
          destination={showAllRoutes ? null : route.destination ?? null}
          context={context}
          height={520}
          showRoute={!showAllRoutes}
          selectedId={selectedStop}
          onSelect={setSelectedStop}
        />

        {!showAllRoutes && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">{formatDate(route.date)}</p>
                <p className="text-[11px] text-ink-500">
                  {route.stops.length} visitas · {formatKm(route.totalDistanceMeters)} ·{' '}
                  {formatDuration(route.totalDurationSeconds)}
                  {route.score ? ` · score ${formatNumber(route.score)}` : ''}
                </p>
              </div>
              <Link href={`/agenda/${route.date}`}>
                <Button size="sm" variant="outline">Abrir roteiro</Button>
              </Link>
            </div>
            <CardContent className="!py-2">
              <ol className="divide-y divide-ink-100">
                {route.stops.map((stop) => (
                  <li
                    key={stop.id}
                    onMouseEnter={() => setSelectedStop(stop.id)}
                    onMouseLeave={() => setSelectedStop(null)}
                    className={cn(
                      '-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
                      selectedStop === stop.id && 'bg-ink-50',
                    )}
                  >
                    <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-md bg-ink-100 text-[10px] font-semibold text-ink-600">
                      {stop.sequence}
                    </span>
                    <span className="tabular w-10 shrink-0 text-[11px] text-ink-500">
                      {formatTime(stop.estimatedArrival)}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-xs',
                        stop.status === 'CANCELLED'
                          ? 'text-ink-400 line-through decoration-ink-300'
                          : 'text-ink-800',
                      )}
                    >
                      {stop.clinicName}
                    </span>
                    <span className="hidden truncate text-[11px] text-ink-400 sm:block">
                      {stop.neighborhood}
                    </span>
                    {stop.status === 'COMPLETED' && <Badge tone="positive">Feita</Badge>}
                    {stop.status === 'CANCELLED' && <Badge tone="neutral">Cancelada</Badge>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
