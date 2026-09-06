'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  ArrowUpDown,
  Check,
  GripVertical,
  Map as MapIcon,
  Navigation,
  Repeat,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CategoryBadge,
  Dialog,
  Spinner,
  Tooltip,
} from '@/components/ui';
import { GoogleRouteMap } from '@/components/map/google-route-map';
import { RouteMap } from '@/components/map/route-map';
import type { SerializedRoute, SerializedStop } from '@/components/route/types';
import { cn, formatDuration, formatKm, formatNumber, formatTime, VISIT_STATUS_LABEL } from '@/lib/utils';

/**
 * ROTEIRO DO DIA — a tela operacional.
 *
 * Suporta as tres acoes que o produto promete (secoes 29, 30, 31):
 *  - navegar (abre o app de mapas no destino);
 *  - reordenar arrastando, com recalculo real de distancia, tempo e score;
 *  - trocar uma clinica por outra proxima, com o custo adicional calculado.
 *
 * Toda edicao vai ao servidor e volta com numeros recalculados pelo motor —
 * nunca "ajustamos" as metricas no cliente, porque isso produziria uma tela
 * que mente sobre a rota salva.
 */
export function DayWorkspace({
  route: initialRoute,
  context,
  scoreBreakdown,
  browserMapsKey,
}: {
  route: SerializedRoute;
  context: Array<{ lat: number; lng: number }>;
  scoreBreakdown: { backtracking?: number; concentrationMeters?: number; detourMeters?: number };
  browserMapsKey: string;
}) {
  const router = useRouter();
  const [route, setRoute] = React.useState(initialRoute);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [swapTarget, setSwapTarget] = React.useState<SerializedStop | null>(null);
  const [analysis, setAnalysis] = React.useState<string | null>(initialRoute.aiSummary ?? null);
  const [analyzing, setAnalyzing] = React.useState(false);

  React.useEffect(() => {
    setRoute(initialRoute);
    setDirty(false);
    setAnalysis(initialRoute.aiSummary ?? null);
  }, [initialRoute]);

  const mapStops = route.stops
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => ({
      id: s.id,
      lat: s.lat!,
      lng: s.lng!,
      label: s.clinicName,
      sublabel: s.neighborhood,
      sequence: s.sequence,
      category: s.category,
      status: s.status,
    }));

  function reorderLocally(fromId: string, toId: string) {
    setRoute((current) => {
      const stops = [...current.stops];
      const fromIndex = stops.findIndex((s) => s.id === fromId);
      const toIndex = stops.findIndex((s) => s.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
      const [moved] = stops.splice(fromIndex, 1);
      stops.splice(toIndex, 0, moved);
      return { ...current, stops: stops.map((s, i) => ({ ...s, sequence: i + 1 })) };
    });
    setDirty(true);
  }

  async function persistOrder(reoptimize = false) {
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/routes/${route.id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clinicIds: route.stops.map((s) => s.clinicId), reoptimize }),
    });

    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível recalcular a rota.');
      return;
    }

    setDirty(false);
    setAnalysis(null);
    router.refresh();
  }

  async function swap(clinicId: string) {
    if (!swapTarget) return;
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/routes/${route.id}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence: swapTarget.sequence, clinicId }),
    });

    const data = await response.json();
    setSaving(false);
    setSwapTarget(null);

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível trocar a clínica.');
      return;
    }

    setAnalysis(null);
    router.refresh();
  }

  async function updateStatus(stop: SerializedStop, status: string) {
    if (!stop.visitId) return;
    setRoute((current) => ({
      ...current,
      stops: current.stops.map((s) => (s.id === stop.id ? { ...s, status } : s)),
    }));

    await fetch(`/api/visits/${stop.visitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function askClaude() {
    setAnalyzing(true);
    const response = await fetch(`/api/routes/${route.id}/analyze`, { method: 'POST' });
    const data = await response.json().catch(() => ({ summary: null }));
    setAnalysis(data.summary);
    setAnalyzing(false);
  }

  const completed = route.stops.filter((s) => s.status === 'COMPLETED').length;
  const fullRouteUrl = buildFullRouteUrl(route);

  return (
    <div className="space-y-5">
      {/* Metricas do dia */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visitas" value={String(route.stops.length)} hint={`${completed} concluídas`} />
        <Stat
          label={route.estimated ? 'Distância estimada' : 'Distância'}
          value={formatKm(route.totalDistanceMeters)}
        />
        <Stat label="Deslocamento" value={formatDuration(route.totalDurationSeconds)} />
        <Stat
          label="Score"
          value={formatNumber(route.score ?? 0)}
          hint={
            scoreBreakdown.backtracking !== undefined
              ? `${scoreBreakdown.backtracking} inversões · raio ${formatKm(scoreBreakdown.concentrationMeters ?? 0, 1)}`
              : undefined
          }
        />
      </div>

      {dirty && (
        <Alert tone="warning" title="Ordem alterada">
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => persistOrder(false)} loading={saving}>
              Salvar nova ordem
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setRoute(initialRoute); setDirty(false); }}>
              Desfazer
            </Button>
          </div>
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_26rem]">
        {/* Lista de paradas */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-5 py-3">
            <p className="text-sm font-semibold text-ink-900">Roteiro</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => persistOrder(true)} loading={saving}>
                <ArrowUpDown className="size-3.5" />
                Reotimizar
              </Button>
              {fullRouteUrl && (
                <a href={fullRouteUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">
                    <MapIcon className="size-3.5" />
                    Abrir rota completa
                  </Button>
                </a>
              )}
            </div>
          </div>

          <ol className="divide-y divide-ink-100">
            {route.stops.map((stop) => {
              const completedStop = stop.status === 'COMPLETED';
              const cancelled = stop.status === 'CANCELLED';

              return (
                <li
                  key={stop.id}
                  draggable={!completedStop}
                  onDragStart={() => setDragging(stop.id)}
                  onDragEnd={() => { setDragging(null); setDragOver(null); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(stop.id); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) reorderLocally(dragging, stop.id);
                    setDragging(null);
                    setDragOver(null);
                  }}
                  onMouseEnter={() => setSelectedId(stop.id)}
                  onMouseLeave={() => setSelectedId(null)}
                  className={cn(
                    'group flex items-center gap-3 px-3 py-3 transition-colors sm:px-5',
                    dragging === stop.id && 'opacity-40',
                    dragOver === stop.id && dragging !== stop.id && 'bg-brand-50',
                    selectedId === stop.id && 'bg-ink-50',
                    cancelled && 'opacity-55',
                  )}
                >
                  <span
                    className={cn(
                      'text-ink-300 transition-colors',
                      completedStop ? 'invisible' : 'cursor-grab active:cursor-grabbing group-hover:text-ink-500',
                    )}
                  >
                    <GripVertical className="size-4" />
                  </span>

                  <span
                    className={cn(
                      'tabular flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
                      completedStop
                        ? 'bg-[var(--color-positive-soft)] text-[color-mix(in_oklch,var(--color-positive),black_30%)]'
                        : 'bg-brand-600 text-white',
                    )}
                  >
                    {completedStop ? <Check className="size-3.5" strokeWidth={3} /> : stop.sequence}
                  </span>

                  <span className="tabular w-11 shrink-0 text-xs font-medium text-ink-600">
                    {formatTime(stop.estimatedArrival)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium text-ink-900', (completedStop || cancelled) && 'line-through decoration-ink-300')}>
                      {stop.clinicName}
                    </p>
                    <p className="truncate text-[11px] text-ink-400">
                      {stop.neighborhood}
                      {stop.address && <> · {stop.address}</>}
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="tabular text-[11px] font-medium text-ink-600">
                      {stop.distanceFromPreviousMeters > 0 ? `+${formatKm(stop.distanceFromPreviousMeters, 1)}` : '—'}
                    </p>
                    <p className="tabular text-[10px] text-ink-400">
                      {stop.durationFromPreviousSeconds > 0 ? formatDuration(stop.durationFromPreviousSeconds) : ''}
                    </p>
                  </div>

                  <div className="hidden md:block">
                    <CategoryBadge category={stop.category} />
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {stop.lat !== null && stop.lng !== null && (
                      <Tooltip label="Navegar">
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex size-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-700"
                        >
                          <Navigation className="size-4" strokeWidth={1.75} />
                        </a>
                      </Tooltip>
                    )}

                    {!completedStop && (
                      <Tooltip label="Trocar clínica">
                        <button
                          onClick={() => setSwapTarget(stop)}
                          className="flex size-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-700"
                        >
                          <Repeat className="size-4" strokeWidth={1.75} />
                        </button>
                      </Tooltip>
                    )}

                    {!completedStop && !cancelled && (
                      <>
                        <Tooltip label="Marcar como realizada">
                          <button
                            onClick={() => updateStatus(stop, 'COMPLETED')}
                            className="flex size-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-[var(--color-positive-soft)] hover:text-[var(--color-positive)]"
                          >
                            <Check className="size-4" strokeWidth={2.25} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Cancelar visita">
                          <button
                            onClick={() => updateStatus(stop, 'CANCELLED')}
                            className="flex size-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                          >
                            <X className="size-4" strokeWidth={2.25} />
                          </button>
                        </Tooltip>
                      </>
                    )}

                    {(completedStop || cancelled) && (
                      <Badge tone={completedStop ? 'positive' : 'neutral'} className="ml-1">
                        {VISIT_STATUS_LABEL[stop.status]}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* Mapa + analise */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {browserMapsKey ? (
            <GoogleRouteMap
              apiKey={browserMapsKey}
              stops={mapStops}
              origin={route.origin}
              destination={route.destination ?? null}
              context={context}
              height={380}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <RouteMap
              stops={mapStops}
              origin={route.origin}
              destination={route.destination ?? null}
              context={context}
              height={380}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}

          <Card>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink-800">Análise da rota</p>
                <Button size="sm" variant="ghost" onClick={askClaude} loading={analyzing}>
                  {!analyzing && <Sparkles className="size-3.5" />}
                  {analysis ? 'Atualizar' : 'Analisar'}
                </Button>
              </div>

              {analysis ? (
                <p className="text-[11px] leading-relaxed text-ink-600">{analysis}</p>
              ) : (
                <p className="text-[11px] leading-relaxed text-ink-400">
                  O Claude lê as métricas desta rota e explica em uma frase por que ela faz sentido.
                  Requer <code className="rounded bg-ink-100 px-1">ANTHROPIC_API_KEY</code> configurada.
                </p>
              )}

              <dl className="space-y-1 border-t border-ink-200 pt-2.5 text-[11px]">
                <StatRow label="Inversões de sentido" value={String(scoreBreakdown.backtracking ?? 0)} />
                <StatRow
                  label="Concentração (raio médio)"
                  value={formatKm(scoreBreakdown.concentrationMeters ?? 0, 1)}
                />
                <StatRow label="Desvio acumulado" value={formatKm(scoreBreakdown.detourMeters ?? 0, 1)} />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <SwapDialog
        routeId={route.id}
        stop={swapTarget}
        onClose={() => setSwapTarget(null)}
        onPick={swap}
        saving={saving}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="!px-4 !py-3">
        <p className="text-[11px] font-medium text-ink-500">{label}</p>
        <p className="tabular mt-0.5 text-xl font-semibold tracking-tight text-ink-900">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[10px] text-ink-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular font-medium text-ink-700">{value}</dd>
    </div>
  );
}

interface Alternative {
  clinicId: string;
  name: string;
  neighborhood: string | null;
  category: string;
  extraMinutes: number;
  extraMeters: number;
}

/** "Trocar visita" (secao 31): alternativas ordenadas pelo custo real. */
function SwapDialog({
  routeId,
  stop,
  onClose,
  onPick,
  saving,
}: {
  routeId: string;
  stop: SerializedStop | null;
  onClose: () => void;
  onPick: (clinicId: string) => void;
  saving: boolean;
}) {
  const [alternatives, setAlternatives] = React.useState<Alternative[] | null>(null);

  React.useEffect(() => {
    if (!stop) {
      setAlternatives(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/routes/${routeId}/alternatives?sequence=${stop.sequence}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAlternatives(data.alternatives ?? []);
      })
      .catch(() => {
        if (!cancelled) setAlternatives([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stop, routeId]);

  return (
    <Dialog
      open={Boolean(stop)}
      onClose={onClose}
      title="Trocar visita"
      description={stop ? `Alternativas próximas para substituir ${stop.clinicName}` : undefined}
    >
      {alternatives === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-ink-500">
          <Spinner className="size-4" />
          Calculando alternativas...
        </div>
      ) : alternatives.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-500">
          Nenhuma clínica disponível fora do plano deste mês.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {alternatives.map((alt) => (
            <li key={alt.clinicId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{alt.name}</p>
                <p className="truncate text-[11px] text-ink-400">{alt.neighborhood}</p>
              </div>
              <CategoryBadge category={alt.category} />
              <span
                className={cn(
                  'tabular w-16 text-right text-xs font-medium',
                  alt.extraMinutes <= 0 ? 'text-[var(--color-positive)]' : 'text-ink-600',
                )}
              >
                {alt.extraMinutes > 0 ? '+' : ''}
                {alt.extraMinutes} min
              </span>
              <Button size="sm" variant="outline" onClick={() => onPick(alt.clinicId)} disabled={saving}>
                Trocar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Rota completa no Google Maps: origem + ate 9 waypoints + destino. */
function buildFullRouteUrl(route: SerializedRoute): string | null {
  const points = route.stops.filter((s) => s.lat !== null && s.lng !== null);
  if (points.length === 0) return null;

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  if (route.origin) url.searchParams.set('origin', `${route.origin.lat},${route.origin.lng}`);

  const destination = route.destination ?? {
    lat: points[points.length - 1].lat!,
    lng: points[points.length - 1].lng!,
  };
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);

  const waypoints = route.destination ? points : points.slice(0, -1);
  if (waypoints.length > 0) {
    url.searchParams.set(
      'waypoints',
      waypoints.slice(0, 9).map((p) => `${p.lat},${p.lng}`).join('|'),
    );
  }
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
