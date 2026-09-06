import type { LatLng, TravelMatrix, TravelMatrixRequest } from '@/lib/route-planner';

export interface GeocodeQuery {
  name?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
}

export interface GeocodeCandidate extends LatLng {
  label: string;
  precision: 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE' | 'UNKNOWN';
  placeId?: string;
}

export interface GeocodeResult {
  status: 'RESOLVED' | 'AMBIGUOUS' | 'FAILED';
  candidates: GeocodeCandidate[];
  provider: string;
  /** Preenchido quando `status` e FAILED. */
  reason?: string;
}

/**
 * Contrato de mapas (secao 75).
 *
 * Toda a aplicacao fala com esta interface. Trocar Google por OSRM, Mapbox ou
 * um provider proprio e trocar a implementacao registrada — nenhum outro
 * arquivo muda.
 */
export interface MapsProvider {
  readonly name: string;
  /** true quando os numeros vem de rota real; false quando sao estimativa. */
  readonly authoritative: boolean;
  geocode(query: GeocodeQuery): Promise<GeocodeResult>;
  travelMatrix(request: TravelMatrixRequest): Promise<TravelMatrix>;
}

export function buildGeocodeString(query: GeocodeQuery): string {
  return [
    query.name?.trim(),
    query.address?.trim(),
    query.neighborhood?.trim(),
    query.city?.trim(),
    query.state?.trim(),
    query.postalCode?.trim(),
    query.country?.trim() ?? 'Brasil',
  ]
    .filter(Boolean)
    .join(', ');
}
