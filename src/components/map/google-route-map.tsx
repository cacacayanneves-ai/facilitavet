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
 *
 * Os tiles do Google sao imagem renderizada pelo proprio Google, fora do
 * alcance do CSS: sem um `styles` escuro dedicado, o mapa ficaria um
 * retangulo branco cravado no meio de uma interface escura. `useIsDarkTheme`
 * observa tanto a escolha explicita (`data-theme`) quanto a preferencia do
 * sistema, para o mapa acompanhar o resto da tela nos dois casos.
 */
export function GoogleRouteMap(props: RouteMapProps & { apiKey: string }) {
  const { apiKey, ...mapProps } = props;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const mapRef = React.useRef<unknown>(null);
  const isDark = useIsDarkTheme();

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

    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

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
      styles: isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
    });
    map.fitBounds(bounds, 56);
    mapRef.current = map;

    const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));
    new google.maps.Polyline({
      path,
      map,
      strokeColor: palette.route,
      strokeOpacity: 0.9,
      strokeWeight: 3,
    });

    props.stops.forEach((stop) => {
      new google.maps.Marker({
        position: { lat: stop.lat, lng: stop.lng },
        map,
        label: stop.sequence
          ? { text: String(stop.sequence), color: palette.markerLabel, fontSize: '11px', fontWeight: '600' }
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
          fillColor: palette.originFill,
          fillOpacity: 1,
          strokeColor: palette.route,
          strokeWeight: 3,
        },
      });
    }
  }, [status, isDark, props.stops, props.origin, props.destination]);

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

/**
 * Acompanha o tema efetivo (escolha explicita OU preferencia do sistema).
 *
 * Reage tanto a mudanca do atributo `data-theme` (o usuario trocou no
 * seletor) quanto a mudanca da preferencia do SO (o usuario nao escolheu
 * nada e o sistema mudou de turno) — as duas formas fazem o mapa reconstruir
 * seu estilo, ja que `styles` do Google Maps nao e algo que o CSS alcance.
 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function compute() {
      const explicit = root.getAttribute('data-theme');
      if (explicit === 'dark') return true;
      if (explicit === 'light') return false;
      return media.matches;
    }

    setIsDark(compute());

    const onChange = () => setIsDark(compute());
    const observer = new MutationObserver(onChange);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    media.addEventListener('change', onChange);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', onChange);
    };
  }, []);

  return isDark;
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

/** Cores da rota/marcadores — espelham os tokens de marca de cada tema. */
const LIGHT_PALETTE = { route: '#1f6b5e', markerLabel: '#fff', originFill: '#ffffff' };
const DARK_PALETTE = { route: '#5fcfae', markerLabel: '#0b241f', originFill: '#1c342f' };

const MAP_STYLE_LIGHT = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/**
 * Estilo noturno.
 *
 * Nao e so "inverter as cores": segue a paleta de referencia da propria
 * Google para tema escuro (fundo quase-preto, agua azul-petroleo, vias em
 * cinza-medio), com o verde da marca entrando so nos elementos que ja eram
 * nossos (rota e marcador de origem, tratados a parte).
 */
const MAP_STYLE_DARK = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'geometry', stylers: [{ color: '#17211e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#17211e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8fa6a0' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2c3835' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3835' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212b28' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4b46' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a1f' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#17211e' }] },
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
