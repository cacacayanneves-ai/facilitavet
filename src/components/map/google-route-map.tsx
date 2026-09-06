'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { RouteMapProps } from './route-map';
import { RouteMap } from './route-map';

/**
 * Variante com tiles reais do Google Maps.
 *
 * A chave usada aqui e a de NAVEGADOR (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY),
 * restrita por referenciador HTTP no console do Google. Ela nao e um segredo:
 * chaves de navegador sao publicas por natureza e protegidas por restricao de
 * origem. A chave de SERVIDOR (Geocoding/Routes) nunca chega aqui.
 *
 * Sem chave, ou se o script falhar ao carregar, cai para o mapa vetorial —
 * o produto nunca fica sem mapa.
 */
export function GoogleRouteMap(props: RouteMapProps & { apiKey: string }) {
  const { apiKey, ...mapProps } = props;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const mapRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    if (!apiKey) {
      setStatus('failed');
      return;
    }
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  React.useEffect(() => {
    if (status !== 'ready' || !containerRef.current) return;

    const google = (window as unknown as { google?: GoogleNamespace }).google;
    if (!google?.maps) {
      setStatus('failed');
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    const points = [
      ...(props.origin ? [props.origin] : []),
      ...props.stops,
      ...(props.destination ? [props.destination] : []),
    ];
    if (points.length === 0) return;
    for (const point of points) bounds.extend({ lat: point.lat, lng: point.lng });

    const map = new google.maps.Map(containerRef.current, {
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      // Estilo enxuto: o dado do produto e a rota, nao pontos de interesse.
      styles: MAP_STYLE,
    });
    map.fitBounds(bounds, 56);
    mapRef.current = map;

    const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));
    new google.maps.Polyline({
      path,
      map,
      strokeColor: '#1f6b5e',
      strokeOpacity: 0.9,
      strokeWeight: 3,
    });

    props.stops.forEach((stop) => {
      new google.maps.Marker({
        position: { lat: stop.lat, lng: stop.lng },
        map,
        label: stop.sequence
          ? { text: String(stop.sequence), color: '#fff', fontSize: '11px', fontWeight: '600' }
          : undefined,
        title: stop.label,
      });
    });

    if (props.origin) {
      new google.maps.Marker({
        position: { lat: props.origin.lat, lng: props.origin.lng },
        map,
        title: props.origin.label,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#1f6b5e',
          strokeWeight: 3,
        },
      });
    }
  }, [status, props.stops, props.origin, props.destination]);

  if (status === 'failed') return <RouteMap {...mapProps} />;

  return (
    <div
      className={cn('relative overflow-hidden rounded-[var(--radius-card)] border border-ink-200', mapProps.className)}
      style={{ height: mapProps.height ?? 420 }}
    >
      <div ref={containerRef} className="size-full" />
      {status === 'loading' && <div className="skeleton absolute inset-0" />}
    </div>
  );
}

let loaderPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem window'));
  if ((window as unknown as { google?: GoogleNamespace }).google?.maps) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=pt-BR&region=BR`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error('Falha ao carregar o Google Maps'));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}

const MAP_STYLE = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/* Tipagem minima do que realmente usamos da API do Google Maps. */
interface GoogleNamespace {
  maps: {
    Map: new (el: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    LatLngBounds: new () => { extend: (p: { lat: number; lng: number }) => void };
    Polyline: new (options: Record<string, unknown>) => unknown;
    Marker: new (options: Record<string, unknown>) => unknown;
    SymbolPath: { CIRCLE: unknown };
  };
}
interface GoogleMap {
  fitBounds: (bounds: unknown, padding?: number) => void;
}
