import { describe, expect, it } from 'vitest';
import { NullClaudeProvider } from '@/lib/providers/claude';
import { OfflineMapsProvider } from '@/lib/providers/maps';
import { LogWhatsAppProvider } from '@/lib/providers/whatsapp';

/**
 * FALLBACK (secao 49).
 *
 * O produto tem que continuar funcionando com Claude, Google Maps e WhatsApp
 * todos fora do ar ao mesmo tempo. Estes testes travam esse contrato.
 */
describe('Claude indisponivel', () => {
  it('nao lanca excecao: devolve null e o sistema segue', async () => {
    const claude = new NullClaudeProvider();
    expect(claude.available).toBe(false);
    await expect(
      claude.analyzeRoute({
        date: '2026-09-14',
        requiredVisits: 6,
        origin: null,
        destination: null,
        regionLabel: 'Vila Mariana',
        candidates: [],
        estimated: true,
      }),
    ).resolves.toBeNull();
    await expect(
      claude.analyzeMonth({
        month: 9,
        year: 2026,
        totalVisits: 100,
        plannedDays: 21,
        totalDistanceKm: 340,
        totalDurationHours: 17,
        averageScore: 73,
        requiredCategories: ['CAT1', 'CAT2'],
        estimated: true,
        savingPercent: null,
        busiestRegions: [],
        warnings: [],
      }),
    ).resolves.toBeNull();
  });
});

describe('Google Maps indisponivel', () => {
  const maps = new OfflineMapsProvider();

  it('nunca inventa coordenada: falha de forma explicita', async () => {
    const result = await maps.geocode({ name: 'Clínica Alfa', neighborhood: 'Moema' });
    expect(result.status).toBe('FAILED');
    expect(result.candidates).toHaveLength(0);
    expect(result.reason).toContain('GOOGLE_MAPS_API_KEY');
  });

  it('produz matriz de deslocamento marcada como estimativa', async () => {
    const points = [
      { lat: -23.5893, lng: -46.6345 },
      { lat: -23.6182, lng: -46.6386 },
    ];
    const matrix = await maps.travelMatrix({ origins: points, destinations: points });

    expect(matrix.estimated).toBe(true);
    expect(matrix.distances[0][0]).toBe(0);
    expect(matrix.distances[0][1]).toBeGreaterThan(0);
    expect(matrix.durations[0][1]).toBeGreaterThan(0);
    // Simetrica e coerente: a ida e a volta custam o mesmo na estimativa.
    expect(matrix.distances[0][1]).toBe(matrix.distances[1][0]);
  });

  it('a estimativa considera sinuosidade da malha, nao linha reta', async () => {
    const points = [
      { lat: -23.55, lng: -46.63 },
      { lat: -23.65, lng: -46.63 },
    ];
    const matrix = await maps.travelMatrix({ origins: points, destinations: points });
    // ~11,1 km em linha reta; com fator de desvio deve passar de 14 km.
    expect(matrix.distances[0][1]).toBeGreaterThan(14_000);
    expect(matrix.distances[0][1]).toBeLessThan(17_000);
  });
});

describe('WhatsApp indisponivel', () => {
  it('registra a mensagem como nao enviada em vez de falhar em silencio', async () => {
    const provider = new LogWhatsAppProvider();
    const result = await provider.send({ to: '5511988887766', body: 'Roteiro de hoje' });
    expect(result.status).toBe('SKIPPED');
    expect(result.error).toContain('não enviada');
  });
});
