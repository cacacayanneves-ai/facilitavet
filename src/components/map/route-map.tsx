'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * MAPA DE ROTA (secao 28).
 *
 * Renderizacao vetorial propria em vez de depender de tiles.
 *
 * Por que: o mapa e uma tela CENTRAL do produto e nao pode depender de uma
 * chave de API para existir. Tiles do Google exigem chave de navegador, cota e
 * conexao; sem eles a tela ficaria em branco. Aqui projetamos as coordenadas
 * reais em SVG, com a carteira inteira como contexto de fundo, a rota do dia em
 * destaque e paradas numeradas. Quando ha chave de navegador configurada, o
 * componente `GoogleRouteMap` assume e desenha sobre tiles reais.
 *
 * A projecao e a mesma equirretangular local usada pelo motor, entao a forma da
 * rota na tela corresponde a geometria que o algoritmo otimizou.
 */

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string | null;
  sequence?: number;
  category?: string;
  status?: string;
}

export interface RouteMapProps {
  stops: MapPoint[];
  origin?: { lat: number; lng: number; label: string } | null;
  destination?: { lat: number; lng: number; label: string } | null;
  /** Carteira completa, desenhada em cinza claro como contexto geografico. */
  context?: Array<{ lat: number; lng: number }>;
  className?: string;
  height?: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  showRoute?: boolean;
}

const CATEGORY_COLOR: Record<string, string> = {
  CAT1: 'var(--color-cat1)',
  CAT2: 'var(--color-cat2)',
  CAT3: 'var(--color-cat3)',
};

export function RouteMap({
  stops,
  origin,
  destination,
  context = [],
  className,
  height = 420,
  onSelect,
  selectedId,
  showRoute = true,
}: RouteMapProps) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  const geometry = React.useMemo(
    () => buildGeometry({ stops, origin, destination, context, height }),
    [stops, origin, destination, context, height],
  );

  if (!geometry) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-ink-100/50 text-xs text-ink-500',
          className,
        )}
        style={{ height }}
      >
        Sem clínicas localizadas para exibir no mapa.
      </div>
    );
  }

  const { width, viewHeight, project, path } = geometry;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-[color-mix(in_oklch,var(--color-brand-50),white_55%)]',
        className,
      )}
      style={{ height }}
    >
      <svg
        viewBox={`0 0 ${width} ${viewHeight}`}
        className="size-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mapa da rota"
      >
        <defs>
          <pattern id="fv-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0v40" fill="none" stroke="var(--color-ink-200)" strokeWidth="0.6" opacity="0.55" />
          </pattern>
          <filter id="fv-pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodOpacity="0.22" />
          </filter>
        </defs>

        <rect width={width} height={viewHeight} fill="url(#fv-grid)" />

        {/* Contexto: a carteira inteira, para o usuario situar a rota do dia
            dentro da cidade em vez de ver pontos flutuando no vazio. */}
        {context.map((point, index) => {
          const [x, y] = project(point);
          return <circle key={index} cx={x} cy={y} r={1.9} fill="var(--color-ink-300)" opacity={0.65} />;
        })}

        {/* Linha da rota */}
        {showRoute && path.length > 1 && (
          <>
            <polyline
              points={path.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="var(--color-brand-600)"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.14}
            />
            <polyline
              points={path.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="var(--color-brand-600)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1000"
              strokeDashoffset="1000"
            >
              <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="1.1s" fill="freeze" />
            </polyline>
          </>
        )}

        {/* Origem */}
        {origin && <AnchorMarker point={project(origin)} tone="brand" label="Origem" />}
        {destination && <AnchorMarker point={project(destination)} tone="accent" label="Destino" />}

        {/* Paradas */}
        {stops.map((stop) => {
          const [x, y] = project(stop);
          const active = hovered === stop.id || selectedId === stop.id;
          const color = stop.status === 'COMPLETED'
            ? 'var(--color-positive)'
            : stop.status === 'CANCELLED'
              ? 'var(--color-ink-400)'
              : CATEGORY_COLOR[stop.category ?? 'CAT1'] ?? 'var(--color-brand-600)';

          return (
            <g
              key={stop.id}
              transform={`translate(${x} ${y})`}
              className={cn('transition-transform duration-150', onSelect && 'cursor-pointer')}
              onMouseEnter={() => setHovered(stop.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(stop.id)}
            >
              {active && <circle r={16} fill={color} opacity={0.12} />}
              <circle
                r={active ? 12 : 10.5}
                fill={color}
                stroke="white"
                strokeWidth={2}
                filter="url(#fv-pin-shadow)"
                className="transition-all duration-150"
              />
              {stop.sequence !== undefined && (
                <text
                  y={3.6}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fill="white"
                  fontSize={10.5}
                  fontWeight={650}
                >
                  {stop.sequence}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip do ponto sob o cursor */}
      {hovered && (() => {
        const stop = stops.find((s) => s.id === hovered);
        if (!stop) return null;
        const [x, y] = project(stop);
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full animate-[fade_0.12s_ease-out]"
            style={{ left: `${(x / width) * 100}%`, top: `calc(${(y / viewHeight) * 100}% - 14px)` }}
          >
            <div className="whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
              <span className="font-semibold">{stop.label}</span>
              {stop.sublabel && <span className="ml-1.5 text-ink-300">{stop.sublabel}</span>}
            </div>
          </div>
        );
      })()}

      <MapLegend hasContext={context.length > 0} hasOrigin={Boolean(origin)} />
    </div>
  );
}

function AnchorMarker({
  point,
  tone,
  label,
}: {
  point: [number, number];
  tone: 'brand' | 'accent';
  label: string;
}) {
  const color = tone === 'brand' ? 'var(--color-brand-800)' : 'var(--color-accent-600)';
  return (
    <g transform={`translate(${point[0]} ${point[1]})`}>
      <circle r={9} fill="white" stroke={color} strokeWidth={2.5} filter="url(#fv-pin-shadow)" />
      <circle r={3.6} fill={color} />
      <title>{label}</title>
    </g>
  );
}

function MapLegend({ hasContext, hasOrigin }: { hasContext: boolean; hasOrigin: boolean }) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-ink-500 shadow-[var(--shadow-subtle)] backdrop-blur-sm">
      {hasOrigin && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border-2 border-brand-800 bg-white" /> Origem
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--color-cat1)]" /> Cat 1
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--color-cat2)]" /> Cat 2
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--color-cat3)]" /> Cat 3
      </span>
      {hasContext && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ink-300" /> Carteira
        </span>
      )}
    </div>
  );
}

/** Projeta lat/lng num plano metrico local e ajusta ao viewport com margem. */
function buildGeometry(args: {
  stops: MapPoint[];
  origin?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  context: Array<{ lat: number; lng: number }>;
  height: number;
}) {
  const all = [
    ...args.stops,
    ...(args.origin ? [args.origin] : []),
    ...(args.destination ? [args.destination] : []),
  ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (all.length === 0) return null;

  const width = 800;
  const viewHeight = Math.round((args.height / 640) * 800) || 480;
  const padding = 46;

  const refLat = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const mPerDegLat = 111_132.92;
  const mPerDegLng = 111_412.84 * Math.cos((refLat * Math.PI) / 180);

  // O enquadramento considera SOMENTE a rota; a carteira de fundo pode
  // extrapolar as bordas, o que e proposital: o dia fica legivel e o resto da
  // cidade aparece como contexto.
  const xs = all.map((p) => p.lng * mPerDegLng);
  const ys = all.map((p) => -p.lat * mPerDegLat);

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // Um unico ponto (ou pontos colineares) geraria divisao por zero.
  const spanX = Math.max(maxX - minX, 400);
  const spanY = Math.max(maxY - minY, 400);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const availableW = width - padding * 2;
  const availableH = viewHeight - padding * 2;
  const scale = Math.min(availableW / spanX, availableH / spanY);

  minX = centerX - availableW / (2 * scale);
  minY = centerY - availableH / (2 * scale);

  const project = (p: { lat: number; lng: number }): [number, number] => [
    padding + (p.lng * mPerDegLng - minX) * scale,
    padding + (-p.lat * mPerDegLat - minY) * scale,
  ];

  const path: Array<[number, number]> = [];
  if (args.origin) path.push(project(args.origin));
  for (const stop of args.stops) path.push(project(stop));
  if (args.destination) path.push(project(args.destination));

  return { width, viewHeight, project, path };
}
