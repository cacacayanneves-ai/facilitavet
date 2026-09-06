import { describe, expect, it } from 'vitest';
import {
  buildFullRouteUrl,
  buildNavigationUrl,
  buildRouteMessage,
  formatDuration,
  formatKm,
} from '@/lib/services/whatsapp-message';
import { normalizePhone } from '@/lib/providers/whatsapp/types';

const baseInput = {
  date: new Date('2026-09-14T00:00:00.000Z'),
  stops: [
    { sequence: 1, time: '08:00', clinicName: 'Clínica Veterinária Alfa', neighborhood: 'Vila Mariana' },
    { sequence: 2, time: '09:10', clinicName: 'Hospital Veterinário Beta', neighborhood: 'Vila Mariana' },
    { sequence: 3, time: '10:15', clinicName: 'Clínica Gama', neighborhood: 'Saúde' },
  ],
  totalDistanceMeters: 42_000,
  totalDurationSeconds: 11_400,
  estimated: false,
  routeUrl: 'https://app.facilitavet.com/agenda/2026-09-14',
  mapUrl: 'https://www.google.com/maps/dir/?api=1',
  include: { route: true, distance: true, times: true, mapLink: true },
};

describe('mensagem do WhatsApp', () => {
  it('monta o roteiro completo com data, paradas e resumo', () => {
    const message = buildRouteMessage(baseInput);
    expect(message).toContain('Segunda-feira, 14/09/2026');
    expect(message).toContain('3 visitas programadas');
    expect(message).toContain('1️⃣ 08:00 — Clínica Veterinária Alfa');
    expect(message).toContain('📍 Vila Mariana');
    expect(message).toContain('🚗 Distância: 42 km');
    expect(message).toContain('⏱️ Deslocamento: 3h10');
    expect(message).toContain(baseInput.routeUrl);
  });

  it('marca explicitamente quando os numeros sao estimativa', () => {
    const message = buildRouteMessage({ ...baseInput, estimated: true });
    expect(message).toContain('≈ 42 km');
    expect(message).toContain('(estimativa');
  });

  it('respeita as preferencias de conteudo do usuario', () => {
    const message = buildRouteMessage({
      ...baseInput,
      include: { route: true, distance: false, times: false, mapLink: false },
    });
    expect(message).toContain('Clínica Veterinária Alfa');
    expect(message).not.toContain('08:00');
    expect(message).not.toContain('🚗');
    expect(message).not.toContain('🗺️');
  });

  it('usa singular quando ha uma unica visita', () => {
    const message = buildRouteMessage({ ...baseInput, stops: [baseInput.stops[0]] });
    expect(message).toContain('1 visita programada');
  });

  it('formata distancia e duracao de forma legivel', () => {
    expect(formatKm(42_000)).toBe('42 km');
    expect(formatDuration(11_400)).toBe('3h10');
    expect(formatDuration(2_700)).toBe('45min');
    expect(formatDuration(7_200)).toBe('2h00');
  });
});

describe('links de navegacao', () => {
  it('gera link direto para uma clinica sem exigir chave de API', () => {
    const url = buildNavigationUrl({ lat: -23.5893, lng: -46.6345 });
    expect(url).toContain('destination=-23.5893,-46.6345');
    expect(url).toContain('travelmode=driving');
    expect(url).not.toContain('key=');
  });

  it('monta a rota completa com origem, waypoints e destino', () => {
    const url = buildFullRouteUrl({
      origin: { lat: -23.6, lng: -46.6 },
      stops: [
        { lat: -23.58, lng: -46.63 },
        { lat: -23.57, lng: -46.64 },
        { lat: -23.56, lng: -46.65 },
      ],
      destination: null,
    })!;
    const params = new URL(url).searchParams;
    expect(params.get('origin')).toBe('-23.6,-46.6');
    // Sem destino explicito, a ultima parada vira o destino.
    expect(params.get('destination')).toBe('-23.56,-46.65');
    expect(params.get('waypoints')).toBe('-23.58,-46.63|-23.57,-46.64');
  });

  it('limita os waypoints ao maximo suportado pelo Google', () => {
    const stops = Array.from({ length: 15 }, (_, i) => ({ lat: -23.5 - i / 100, lng: -46.6 }));
    const url = buildFullRouteUrl({ origin: null, stops, destination: null })!;
    const waypoints = new URL(url).searchParams.get('waypoints') ?? '';
    expect(waypoints.split('|').length).toBeLessThanOrEqual(9);
  });

  it('retorna null quando nao ha paradas', () => {
    expect(buildFullRouteUrl({ origin: null, stops: [], destination: null })).toBeNull();
  });
});

describe('normalizacao de telefone', () => {
  it('adiciona o DDI brasileiro quando ausente', () => {
    expect(normalizePhone('(11) 98888-7766')).toBe('5511988887766');
    expect(normalizePhone('11 3333-4444')).toBe('551133334444');
  });

  it('preserva numeros ja em E.164', () => {
    expect(normalizePhone('5511988887766')).toBe('5511988887766');
  });

  it('recusa numeros curtos demais', () => {
    expect(normalizePhone('9999')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});
