import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleMapsProvider } from '@/lib/providers/maps/google';

/**
 * Escolha entre Geocoding API e Places API (secao 75).
 *
 * Uma carteira comercial real com frequencia so tem nome + bairro, sem
 * endereco — a Geocoding API nao acha nada util nesse caso (ela interpreta
 * rua/numero), so a Places API (busca por nome de estabelecimento) tem
 * chance de acertar. Estes testes travam a escolha certa e o controle de
 * custo (field mask minimo, nunca mais de 5 candidatos).
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('escolha de endpoint conforme os dados disponiveis', () => {
  it('com endereco, usa a Geocoding API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'OK',
        results: [
          {
            formatted_address: 'Rua Amoreira, 100 - Moema, São Paulo - SP',
            place_id: 'abc',
            geometry: { location: { lat: -23.6, lng: -46.6 }, location_type: 'ROOFTOP' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleMapsProvider({ apiKey: 'test-key', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Clínica Alfa', address: 'Rua Amoreira, 100', neighborhood: 'Moema' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('maps.googleapis.com/maps/api/geocode/json');
    expect(result.status).toBe('RESOLVED');
    expect(result.candidates[0].lat).toBe(-23.6);
  });

  it('sem endereco mas com nome, usa a Places API (busca por estabelecimento)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: 'place-1',
            formattedAddress: 'R. das Flores, 50 - Campo Grande, Rio de Janeiro - RJ',
            location: { latitude: -22.9, longitude: -43.55 },
            displayName: { text: 'Cinco Estrelas', languageCode: 'pt-BR' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleMapsProvider({ apiKey: 'test-key', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Cinco Estrelas', neighborhood: 'Campo Grande', city: 'Rio de Janeiro', state: 'RJ' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    // Cada campo a mais no field mask sobe o tier de preco da Places API —
    // pedir so o que se usa nao e escolha de estilo, e controle de custo.
    expect(init.headers['X-Goog-FieldMask']).toBe('places.id,places.formattedAddress,places.location,places.displayName');
    expect(JSON.parse(init.body).textQuery).toContain('Cinco Estrelas');
    expect(JSON.parse(init.body).textQuery).toContain('Campo Grande');

    expect(result.status).toBe('RESOLVED');
    expect(result.candidates[0].lat).toBe(-22.9);
    expect(result.candidates[0].placeId).toBe('place-1');
  });

  it('sem endereco e sem nome, nao chama a Places API (nada para buscar)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ZERO_RESULTS' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleMapsProvider({ apiKey: 'test-key', elementBudget: 4000 });
    await provider.geocode({ neighborhood: 'Moema' });

    // Sem nome nem endereco cai na Geocoding API (rota antiga), nao na Places.
    expect(String(fetchMock.mock.calls[0][0])).toContain('geocode/json');
  });
});

describe('Places API: multiplos resultados exigem decisao humana', () => {
  it('um resultado unico resolve sozinho', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          places: [{ id: 'p1', location: { latitude: -22.9, longitude: -43.5 }, displayName: { text: 'X', languageCode: 'pt' } }],
        }),
      ),
    );
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Clínica X', neighborhood: 'Bangu' });
    expect(result.status).toBe('RESOLVED');
  });

  it('dois ou mais resultados plausiveis viram AMBIGUOUS, nunca uma escolha silenciosa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          places: [
            { id: 'p1', location: { latitude: -22.9, longitude: -43.5 }, displayName: { text: 'X', languageCode: 'pt' } },
            { id: 'p2', location: { latitude: -22.91, longitude: -43.51 }, displayName: { text: 'X', languageCode: 'pt' } },
          ],
        }),
      ),
    );
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Clínica X', neighborhood: 'Bangu' });
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.candidates).toHaveLength(2);
  });

  it('nenhum resultado falha de forma explicita, com o texto pesquisado na mensagem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ places: [] })));
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Clínica Fantasma', neighborhood: 'Bangu' });
    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('Clínica Fantasma');
  });

  it('nunca retorna mais de 5 candidatos, mesmo que a API devolva mais', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      location: { latitude: -22.9 + i * 0.001, longitude: -43.5 },
      displayName: { text: 'X', languageCode: 'pt' },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ places: many })));
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    const result = await provider.geocode({ name: 'Clínica X', neighborhood: 'Bangu' });
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });
});

describe('erro HTTP da Places/Routes API', () => {
  it('propaga o motivo do Google, nao so o codigo HTTP (essencial para diagnosticar 403 de chave/restricao)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: 403, message: 'This API key is not authorized to use this service or API.', status: 'PERMISSION_DENIED' } },
          403,
        ),
      ),
    );
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    await expect(provider.geocode({ name: 'Clínica X', neighborhood: 'Bangu' })).rejects.toThrow(
      'Google Maps HTTP 403: This API key is not authorized to use this service or API. (PERMISSION_DENIED)',
    );
  });

  it('sem corpo JSON reconhecivel, cai para o texto cru da resposta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
    const provider = new GoogleMapsProvider({ apiKey: 'k', elementBudget: 4000 });
    await expect(provider.geocode({ name: 'Clínica X', neighborhood: 'Bangu' })).rejects.toThrow(
      'Google Maps HTTP 403: Forbidden',
    );
  });
});
