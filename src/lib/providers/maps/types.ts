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

/**
 * Mais de um candidato plausivel => o usuario decide (secao 9); nunca
 * escolhemos silenciosamente o primeiro. Um unico candidato preciso entre
 * varios imprecisos (ex: rua exata + centro do bairro) resolve sozinho.
 *
 * Fica aqui, e nao dentro de cada provider, porque o cache tambem precisa
 * reclassificar o que leu do banco — se as duas regras divergirem, uma
 * ambiguidade vira "localizada" na segunda validacao.
 */
export function classifyCandidates(candidates: GeocodeCandidate[]): GeocodeResult['status'] {
  if (candidates.length === 0) return 'FAILED';
  if (candidates.length === 1) return 'RESOLVED';
  const precise = candidates.filter((c) => c.precision === 'ROOFTOP' || c.precision === 'RANGE_INTERPOLATED');
  return precise.length === 1 ? 'RESOLVED' : 'AMBIGUOUS';
}

/** Dois resultados a menos disto sao o MESMO lugar devolvido duas vezes. */
const SAME_PLACE_METERS = 150;

function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "Av. de Santa Cruz, 6141 - Bangu" -> "6141"; "R. Sidnei, 97A" -> "97a". */
function houseNumberOf(text: string | null | undefined): string | null {
  const match = (text ?? '').match(/,\s*(?:n[º°o.]?\s*)?(\d+[a-z]?)\b/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Classifica e ordena os candidatos antes de pedir decisao ao usuario.
 *
 * Duas fontes de "ambiguidade falsa" na carteira real:
 *  - o Google devolve o mesmo lugar duas vezes (rotulo identico, mesmo ponto)
 *    — isso nao e escolha nenhuma, vira um candidato so;
 *  - o endereco da planilha tem NUMERO e so um candidato tem aquele numero
 *    ("6141" x "5806" na mesma avenida) — o usuario ja respondeu, e esse.
 * O que sobra de ambiguidade depois disso e real e continua com o usuario.
 */
export function resolveCandidates(
  candidates: GeocodeCandidate[],
  query?: Pick<GeocodeQuery, 'address'>,
): { status: GeocodeResult['status']; candidates: GeocodeCandidate[] } {
  const distinct: GeocodeCandidate[] = [];
  for (const candidate of candidates) {
    // Rotulo igual so conta como mesmo lugar se estiver perto: duas lojas de
    // uma rede, sem endereco no resultado, podem ter o mesmo nome e ser
    // unidades diferentes.
    const duplicate = distinct.some((kept) => {
      const meters = distanceMeters(kept, candidate);
      return meters < SAME_PLACE_METERS || (kept.label === candidate.label && meters < 1_000);
    });
    if (!duplicate) distinct.push(candidate);
  }

  const wanted = houseNumberOf(query?.address);
  if (wanted && distinct.length > 1) {
    const matching = distinct.filter((c) => houseNumberOf(c.label) === wanted);
    if (matching.length === 1) {
      return { status: 'RESOLVED', candidates: [matching[0], ...distinct.filter((c) => c !== matching[0])] };
    }
  }

  return { status: classifyCandidates(distinct), candidates: distinct };
}
