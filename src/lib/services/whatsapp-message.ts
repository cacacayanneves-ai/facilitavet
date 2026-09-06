import { env } from '@/lib/env';

/**
 * Composicao da mensagem do roteiro (secao 40).
 *
 * A mensagem e gerada a partir do roteiro persistido — nunca de texto solto ou
 * de saida de IA. O que o usuario le no WhatsApp e exatamente o que esta no
 * banco naquele instante.
 */

export interface RouteMessageStop {
  sequence: number;
  time: string;
  clinicName: string;
  neighborhood: string | null;
}

export interface RouteMessageInput {
  date: Date;
  stops: RouteMessageStop[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  estimated: boolean;
  routeUrl: string;
  mapUrl?: string;
  include: {
    route: boolean;
    distance: boolean;
    times: boolean;
    mapLink: boolean;
  };
}

const NUMBER_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const WEEKDAYS = [
  'Domingo', 'Segunda-feira', 'Terca-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sabado',
];

export function buildRouteMessage(input: RouteMessageInput): string {
  const lines: string[] = [];
  const weekday = WEEKDAYS[input.date.getUTCDay()];
  const dateLabel = formatDateBR(input.date);

  lines.push('☀️ Bom dia! Seu roteiro de hoje esta pronto.');
  lines.push('');
  lines.push(`📅 ${weekday}, ${dateLabel}`);
  lines.push(`${input.stops.length} visita${input.stops.length === 1 ? '' : 's'} programada${input.stops.length === 1 ? '' : 's'}`);

  if (input.include.route && input.stops.length > 0) {
    lines.push('');
    for (const stop of input.stops) {
      const marker = NUMBER_EMOJI[stop.sequence] ?? `${stop.sequence}.`;
      const time = input.include.times ? `${stop.time} — ` : '';
      lines.push(`${marker} ${time}${stop.clinicName}`);
      if (stop.neighborhood) lines.push(`📍 ${stop.neighborhood}`);
    }
  }

  if (input.include.distance) {
    lines.push('');
    const prefix = input.estimated ? '≈ ' : '';
    lines.push(`🚗 Distancia: ${prefix}${formatKm(input.totalDistanceMeters)}`);
    lines.push(`⏱️ Deslocamento: ${prefix}${formatDuration(input.totalDurationSeconds)}`);
    if (input.estimated) {
      lines.push('(estimativa — rota real depende da Google Routes API)');
    }
  }

  lines.push('');
  lines.push('👉 Abrir roteiro:');
  lines.push(input.routeUrl);

  if (input.include.mapLink && input.mapUrl) {
    lines.push('');
    lines.push('🗺️ Abrir no mapa:');
    lines.push(input.mapUrl);
  }

  return lines.join('\n');
}

export function formatDateBR(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getUTCFullYear()}`;
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(0)} km`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Link de navegacao do Google Maps (secao 29).
 * A Maps URL API e publica e nao consome chave nem cota.
 */
export function buildNavigationUrl(destination: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`;
}

/** Rota completa com waypoints — o Google aceita ate ~9 pontos intermediarios. */
export function buildFullRouteUrl(args: {
  origin?: { lat: number; lng: number } | null;
  stops: Array<{ lat: number; lng: number }>;
  destination?: { lat: number; lng: number } | null;
}): string | null {
  if (args.stops.length === 0) return null;

  const points = [...args.stops];
  const final = args.destination ?? points.pop()!;
  const waypoints = args.destination ? points : points;

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  if (args.origin) url.searchParams.set('origin', `${args.origin.lat},${args.origin.lng}`);
  url.searchParams.set('destination', `${final.lat},${final.lng}`);
  if (waypoints.length > 0) {
    url.searchParams.set(
      'waypoints',
      waypoints.slice(0, 9).map((p) => `${p.lat},${p.lng}`).join('|'),
    );
  }
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

export function routeUrlFor(dateKey: string): string {
  return `${env().APP_URL.replace(/\/$/, '')}/agenda/${dateKey}`;
}
