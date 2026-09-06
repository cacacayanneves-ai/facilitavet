import { estimateMatrix } from '@/lib/route-planner';
import type { TravelMatrix, TravelMatrixRequest } from '@/lib/route-planner';
import type { GeocodeQuery, GeocodeResult, MapsProvider } from './types';

/**
 * Provider offline — o fallback que mantem o produto de pe (secao 49).
 *
 * Nao inventa localizacao: geocodificacao aqui SEMPRE falha explicitamente,
 * porque um palpite de coordenada e pior que um erro visivel. Ja a matriz de
 * deslocamento e uma estimativa geometrica calibrada, sempre marcada como
 * `estimated: true` para que a interface avise o usuario.
 */
export class OfflineMapsProvider implements MapsProvider {
  readonly name = 'offline-geometric';
  readonly authoritative = false;

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    return {
      status: 'FAILED',
      candidates: [],
      provider: this.name,
      reason:
        'Geocodificacao indisponivel: configure GOOGLE_MAPS_API_KEY ou informe latitude e longitude manualmente.',
    };
  }

  async travelMatrix(request: TravelMatrixRequest): Promise<TravelMatrix> {
    return estimateMatrix(request);
  }
}
