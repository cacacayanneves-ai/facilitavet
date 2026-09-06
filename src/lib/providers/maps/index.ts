import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { CachedMapsProvider } from './cached';
import { GoogleMapsProvider } from './google';
import { OfflineMapsProvider } from './offline';
import type { MapsProvider } from './types';

export * from './types';
export { CachedMapsProvider, GoogleMapsProvider, OfflineMapsProvider };

let cached: CachedMapsProvider | null = null;

/**
 * Resolve o provider de mapas conforme o ambiente.
 *
 * "auto" e o comportamento de producao: usa Google quando ha chave, cai para o
 * estimador geometrico quando nao ha. O produto NUNCA deixa de funcionar por
 * falta de chave — apenas passa a marcar os numeros como estimativa.
 */
export function getMapsProvider(): CachedMapsProvider {
  if (cached) return cached;
  const config = env();

  let inner: MapsProvider;
  const wantsGoogle =
    config.MAPS_PROVIDER === 'google' ||
    (config.MAPS_PROVIDER === 'auto' && config.GOOGLE_MAPS_API_KEY.length > 0);

  if (wantsGoogle && config.GOOGLE_MAPS_API_KEY.length > 0) {
    inner = new GoogleMapsProvider({
      apiKey: config.GOOGLE_MAPS_API_KEY,
      elementBudget: config.MAPS_MATRIX_ELEMENT_BUDGET,
    });
  } else {
    if (config.MAPS_PROVIDER === 'google') {
      logger.warn('MAPS_PROVIDER=google sem GOOGLE_MAPS_API_KEY; usando estimativa geometrica', {
        scope: 'maps',
      });
    }
    inner = new OfflineMapsProvider();
  }

  cached = new CachedMapsProvider(inner);
  return cached;
}

/** Util para testes: descarta o provider memoizado. */
export function resetMapsProvider(): void {
  cached = null;
}
