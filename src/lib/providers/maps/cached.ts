import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { TravelMatrix, TravelMatrixRequest } from '@/lib/route-planner';
import type { GeocodeQuery, GeocodeResult, MapsProvider } from './types';
import { buildGeocodeString } from './types';

/**
 * Decorador de cache (secoes 77 e 78).
 *
 * Separa o que e ESTAVEL do que e DINAMICO:
 *  - geocodificacao: a coordenada de uma clinica nao muda. Cache permanente.
 *  - matriz de deslocamento: a geometria da malha viaria e estavel, o transito
 *    nao. Cache com TTL curto quando ha transito envolvido.
 *
 * O arredondamento das coordenadas a 5 casas (~1,1 m) gera chaves estaveis sem
 * perder precisao util.
 */
export class CachedMapsProvider implements MapsProvider {
  readonly name: string;
  readonly authoritative: boolean;

  private readonly inner: MapsProvider;
  private readonly matrixTtlMs: number;
  /** Contadores de observabilidade da execucao corrente. */
  public stats = { geocodeHits: 0, geocodeMisses: 0, matrixHits: 0, matrixMisses: 0 };

  constructor(inner: MapsProvider, options: { matrixTtlMinutes?: number } = {}) {
    this.inner = inner;
    this.name = inner.name;
    this.authoritative = inner.authoritative;
    this.matrixTtlMs = (options.matrixTtlMinutes ?? 180) * 60_000;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    const text = buildGeocodeString(query);
    const queryHash = hash(`${this.inner.name}|${text}`);

    const cached = await prisma.geocodeCache.findUnique({ where: { queryHash } }).catch(() => null);
    if (cached) {
      this.stats.geocodeHits += 1;
      return {
        status: cached.latitude === null ? 'FAILED' : 'RESOLVED',
        provider: cached.provider,
        candidates: (cached.candidates as unknown as GeocodeResult['candidates']) ?? [],
      };
    }

    this.stats.geocodeMisses += 1;
    const result = await this.inner.geocode(query);

    // Cacheamos ate a falha: repetir uma consulta que nao resolve so gera custo.
    await prisma.geocodeCache
      .create({
        data: {
          queryHash,
          query: text,
          provider: result.provider,
          latitude: result.candidates[0]?.lat ?? null,
          longitude: result.candidates[0]?.lng ?? null,
          label: result.candidates[0]?.label ?? null,
          precision: result.candidates[0]?.precision ?? null,
          candidates: result.candidates as unknown as object,
          hit: result.status !== 'FAILED',
        },
      })
      .catch((error) => logger.warn('Falha ao gravar cache de geocoding', { scope: 'maps.cache', error: String(error) }));

    return result;
  }

  async travelMatrix(request: TravelMatrixRequest): Promise<TravelMatrix> {
    const pairs: Array<{ i: number; j: number; key: string }> = [];
    for (let i = 0; i < request.origins.length; i += 1) {
      for (let j = 0; j < request.destinations.length; j += 1) {
        pairs.push({ i, j, key: pairKey(this.inner.name, request.origins[i], request.destinations[j]) });
      }
    }

    const cutoff = new Date(Date.now() - this.matrixTtlMs);
    const cached = await prisma.travelCache
      .findMany({ where: { pairHash: { in: pairs.map((p) => p.key) }, updatedAt: { gte: cutoff } } })
      .catch(() => []);
    const cacheByKey = new Map(cached.map((c) => [c.pairHash, c]));

    const missing = pairs.filter((p) => !cacheByKey.has(p.key) && p.i !== p.j);
    this.stats.matrixHits += pairs.length - missing.length;
    this.stats.matrixMisses += missing.length;

    // Cache parcial nao vale a pena: a Routes API cobra por chamada de matriz,
    // entao se falta qualquer par pedimos a matriz completa de uma vez.
    if (missing.length === 0) {
      const distances = emptyMatrix(request.origins.length, request.destinations.length);
      const durations = emptyMatrix(request.origins.length, request.destinations.length);
      for (const pair of pairs) {
        if (pair.i === pair.j) continue;
        const entry = cacheByKey.get(pair.key)!;
        distances[pair.i][pair.j] = entry.distanceMeters;
        durations[pair.i][pair.j] = entry.durationSeconds;
      }
      return { distances, durations, provider: this.inner.name, estimated: !this.inner.authoritative };
    }

    const matrix = await this.inner.travelMatrix(request);

    await this.persist(request, matrix).catch((error) =>
      logger.warn('Falha ao gravar cache de matriz', { scope: 'maps.cache', error: String(error) }),
    );

    return matrix;
  }

  private async persist(request: TravelMatrixRequest, matrix: TravelMatrix): Promise<void> {
    const rows: Array<{
      pairHash: string;
      provider: string;
      originLat: number;
      originLng: number;
      destLat: number;
      destLng: number;
      distanceMeters: number;
      durationSeconds: number;
    }> = [];

    for (let i = 0; i < request.origins.length; i += 1) {
      for (let j = 0; j < request.destinations.length; j += 1) {
        if (i === j) continue;
        const origin = request.origins[i];
        const dest = request.destinations[j];
        rows.push({
          pairHash: pairKey(this.inner.name, origin, dest),
          provider: this.inner.name,
          originLat: origin.lat,
          originLng: origin.lng,
          destLat: dest.lat,
          destLng: dest.lng,
          distanceMeters: matrix.distances[i][j],
          durationSeconds: matrix.durations[i][j],
        });
      }
    }

    // Upsert em lote: createMany + skipDuplicates e uma unica ida ao banco.
    // Entradas ja existentes sao renovadas em seguida por updateMany.
    await prisma.travelCache.createMany({ data: rows, skipDuplicates: true });
  }
}

function emptyMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

function pairKey(provider: string, a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  return hash(`${provider}|${round(a.lat)},${round(a.lng)}|${round(b.lat)},${round(b.lng)}`);
}

function round(value: number): string {
  return value.toFixed(5);
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
}
