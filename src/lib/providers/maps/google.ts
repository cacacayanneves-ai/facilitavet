import { logger } from '@/lib/logger';
import type { LatLng, TravelMatrix, TravelMatrixRequest } from '@/lib/route-planner';
import { buildGeocodeString, type GeocodeCandidate, type GeocodeQuery, type GeocodeResult, type MapsProvider } from './types';

interface GoogleOptions {
  apiKey: string;
  /** Teto de elementos por chamada — controle de custo (secao 77). */
  elementBudget: number;
  timeoutMs?: number;
}

/**
 * Google Maps Platform — Geocoding API + Routes API (computeRouteMatrix).
 *
 * A chave NUNCA sai do servidor. Todas as chamadas partem daqui, em codigo
 * Node, e o browser so recebe o resultado ja processado.
 *
 * Controle de custo:
 * - `X-Goog-FieldMask` pede apenas os campos usados, o que reduz a cobranca
 *   para o tier basico da Routes API;
 * - a matriz e sempre pedida por DIA (9x9), nunca para a carteira inteira;
 * - o cache em banco (TravelCache/GeocodeCache) evita repetir a mesma pergunta.
 */
export class GoogleMapsProvider implements MapsProvider {
  readonly name = 'google';
  readonly authoritative = true;

  private readonly apiKey: string;
  private readonly elementBudget: number;
  private readonly timeoutMs: number;

  constructor(options: GoogleOptions) {
    this.apiKey = options.apiKey;
    this.elementBudget = options.elementBudget;
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    const address = buildGeocodeString(query);
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('region', 'br');

    const response = await this.fetchJson<GoogleGeocodeResponse>(url.toString());

    if (response.status === 'ZERO_RESULTS' || !response.results?.length) {
      return {
        status: 'FAILED',
        candidates: [],
        provider: this.name,
        reason: `Nenhum resultado para "${address}".`,
      };
    }
    if (response.status !== 'OK') {
      throw new Error(`Geocoding API retornou ${response.status}: ${response.error_message ?? ''}`);
    }

    const candidates: GeocodeCandidate[] = response.results.slice(0, 5).map((r) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      label: r.formatted_address,
      precision: (r.geometry.location_type as GeocodeCandidate['precision']) ?? 'UNKNOWN',
      placeId: r.place_id,
    }));

    // Mais de um resultado plausivel => o usuario decide (secao 9).
    // Nao escolhemos silenciosamente o primeiro.
    const precise = candidates.filter((c) => c.precision === 'ROOFTOP' || c.precision === 'RANGE_INTERPOLATED');
    const status = candidates.length > 1 && precise.length !== 1 ? 'AMBIGUOUS' : 'RESOLVED';

    return { status, candidates, provider: this.name };
  }

  async travelMatrix(request: TravelMatrixRequest): Promise<TravelMatrix> {
    const { origins, destinations } = request;
    const elements = origins.length * destinations.length;

    if (elements > this.elementBudget) {
      throw new Error(
        `Matriz de ${elements} elementos excede o orcamento de ${this.elementBudget}. Reduza o agrupamento ou aumente MAPS_MATRIX_ELEMENT_BUDGET.`,
      );
    }

    const body = {
      origins: origins.map(toWaypoint),
      destinations: destinations.map(toWaypoint),
      travelMode: 'DRIVE',
      // TRAFFIC_AWARE oferece o melhor custo/beneficio: considera transito sem
      // o preco do tier TRAFFIC_AWARE_OPTIMAL.
      routingPreference: 'TRAFFIC_AWARE',
      ...(request.departureTime && request.departureTime.getTime() > Date.now()
        ? { departureTime: request.departureTime.toISOString() }
        : {}),
    };

    const response = await this.fetchJson<GoogleMatrixElement[]>(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,distanceMeters,condition',
        },
        body: JSON.stringify(body),
      },
    );

    const distances = matrixOf(origins.length, destinations.length);
    const durations = matrixOf(origins.length, destinations.length);

    for (const element of response) {
      const i = element.originIndex ?? 0;
      const j = element.destinationIndex ?? 0;
      if (element.condition && element.condition !== 'ROUTE_EXISTS') {
        // Sem rota (ilha, area restrita): mantem um custo alto para que o
        // otimizador evite o par, sem quebrar a matriz.
        distances[i][j] = 10_000_000;
        durations[i][j] = 10_000_000;
        continue;
      }
      distances[i][j] = element.distanceMeters ?? 0;
      durations[i][j] = parseDuration(element.duration);
    }

    return { distances, durations, provider: this.name, estimated: false };
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.error('Google Maps respondeu com erro', {
          scope: 'maps.google',
          status: response.status,
          body: text.slice(0, 500),
        });
        throw new Error(`Google Maps HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toWaypoint(point: LatLng) {
  return {
    waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } },
  };
}

function matrixOf(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

/** A Routes API devolve duracao como string ISO-8601 de segundos: "1234s". */
function parseDuration(value?: string): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace('s', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    place_id: string;
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }>;
}

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
}
