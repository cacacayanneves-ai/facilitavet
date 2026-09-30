import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { commitRows, type NormalizedRow } from '@/lib/services/import';
import { CachedMapsProvider } from '@/lib/providers/maps/cached';
import type { MapsProvider } from '@/lib/providers/maps/types';

/**
 * Reimportar a planilha e o uso normal todo mes. Tres regressoes reais:
 *  - o cache devolvia uma busca AMBIGUA como "localizada", escolhendo sozinho
 *    o primeiro endereco na segunda validacao;
 *  - reimportar apagava localizacao/endereco preenchidos a mao na Carteira;
 *  - "Cão Sucesso" x "CÃO SUCESSO" virava clinica duplicada, apesar de a
 *    revisao prometer "sera atualizada".
 *
 * Requer DATABASE_URL; pulado quando o banco nao esta acessivel.
 */
const prisma = new PrismaClient();
let available = true;
let organizationId = '';
const ORG_SLUG = 'test-import-reimport';
const CACHE_PROVIDER = 'test-reimport-provider';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    available = false;
    return;
  }
  await cleanup();
  const org = await prisma.organization.create({ data: { name: 'Org de teste', slug: ORG_SLUG } });
  organizationId = org.id;
});

afterAll(async () => {
  if (available) await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (org) await prisma.organization.delete({ where: { id: org.id } });
  await prisma.geocodeCache.deleteMany({ where: { provider: CACHE_PROVIDER } });
}

function row(overrides: Partial<NormalizedRow>): NormalizedRow {
  return {
    index: 0,
    name: 'Clínica',
    category: 'CAT1',
    address: null,
    neighborhood: 'Bangu',
    city: 'Rio de Janeiro',
    state: 'RJ',
    postalCode: null,
    phone: null,
    latitude: null,
    longitude: null,
    veterinarians: 1,
    visitSplits: 1,
    notes: null,
    active: true,
    issues: [],
    geocodeStatus: 'AMBIGUOUS',
    geocodeLabel: null,
    geocodeCandidates: [],
    ...overrides,
  };
}

describe.skipIf(!available)('reimportacao da planilha', () => {
  it('atualiza a clinica existente sem duplicar nem apagar o que foi preenchido a mao', async () => {
    const existing = await prisma.clinic.create({
      data: {
        organizationId,
        name: 'Cão Sucesso',
        category: 'CAT1',
        neighborhood: 'Bangu',
        address: 'R. Fonseca, 240',
        phone: '21999999999',
        latitude: -22.87,
        longitude: -43.46,
        geocodeStatus: 'MANUAL',
        veterinarians: 2,
      },
    });

    const summary = await commitRows({
      organizationId,
      rows: [row({ name: 'CÃO SUCESSO', neighborhood: 'BANGU', veterinarians: 4 })],
    });

    expect(summary).toMatchObject({ created: 0, updated: 1, withoutLocation: 0 });
    const clinics = await prisma.clinic.findMany({ where: { organizationId } });
    expect(clinics).toHaveLength(1);
    const updated = clinics[0];
    expect(updated.id).toBe(existing.id);
    expect(updated.veterinarians).toBe(4);
    expect(updated.latitude).toBe(-22.87);
    expect(updated.geocodeStatus).toBe('MANUAL');
    expect(updated.address).toBe('R. Fonseca, 240');
    expect(updated.phone).toBe('21999999999');
  });

  it('busca ambigua em cache continua ambigua (nunca vira escolha silenciosa)', async () => {
    const inner: MapsProvider = {
      name: CACHE_PROVIDER,
      authoritative: true,
      geocode: async () => ({
        status: 'AMBIGUOUS',
        provider: CACHE_PROVIDER,
        candidates: [
          { lat: -22.9, lng: -43.5, label: 'Campo Grande, Rio de Janeiro - RJ', precision: 'ROOFTOP' },
          { lat: -23.2, lng: -47.5, label: 'Centro, Boituva - SP', precision: 'ROOFTOP' },
        ],
      }),
      travelMatrix: async () => {
        throw new Error('nao usado');
      },
    };
    const provider = new CachedMapsProvider(inner);
    const query = { name: 'LAVET', neighborhood: 'Campo Grande' };

    const first = await provider.geocode(query);
    const second = await provider.geocode(query);

    expect(first.status).toBe('AMBIGUOUS');
    expect(provider.stats.geocodeHits).toBe(1);
    expect(second.status).toBe('AMBIGUOUS');
    expect(second.candidates).toHaveLength(2);
  });
});
