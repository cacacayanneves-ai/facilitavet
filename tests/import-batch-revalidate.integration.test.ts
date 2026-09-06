import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { validateRows } from '@/lib/services/import';

/**
 * Teste de integracao contra o banco real.
 *
 * Bug real de producao: clicar em "Validar e localizar" pela SEGUNDA vez no
 * mesmo lote (ex: depois de corrigir a chave do Google Maps, sem reenviar o
 * arquivo) sobrescrevia `ImportBatch.rows` com o formato normalizado, e a
 * segunda validacao lia esse formato como se fosse a planilha original —
 * toda linha virava "sem nome" e "categoria nao informada", porque
 * `row['Nome da clínica']` nao existe mais depois que a linha virou
 * `{name, category, ...}`. A correcao guarda a planilha bruta em
 * `rawRows`, imutavel, e toda validacao (a 1a ou a 5a) le dali. So um teste
 * contra o banco real prova que o campo persiste e sobrevive a um ciclo de
 * update, o que um teste de funcao pura nao pegaria.
 *
 * Requer DATABASE_URL. Pulado automaticamente quando o banco nao esta
 * acessivel, para nao quebrar `npm test` em maquina sem Postgres.
 */
const prisma = new PrismaClient();

let available = true;
let organizationId = '';
let userId = '';

const ORG_SLUG = 'test-import-revalidate';

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
  const user = await prisma.user.create({
    data: {
      organizationId,
      name: 'Teste',
      email: 'import-revalidate@facilitavet.test',
      passwordHash: 'x',
      role: 'OWNER',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  if (available) await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (org) await prisma.organization.delete({ where: { id: org.id } });
}

describe.skipIf(!available)('revalidar um lote de importacao duas vezes', () => {
  it('a segunda validacao ainda ve nome e categoria (nao le o formato ja normalizado)', async () => {
    const rawRows = [{ 'Nome da clínica': 'Clínica Alfa', Categoria: 'CAT1', Bairro: 'Centro' }];
    const mapping = { name: 'Nome da clínica', category: 'Categoria', neighborhood: 'Bairro' };

    const batch = await prisma.importBatch.create({
      data: {
        organizationId,
        userId,
        filename: 'teste.xlsx',
        status: 'MAPPED',
        detectedColumns: Object.keys(rawRows[0]),
        columnMapping: mapping,
        rawRows: rawRows as unknown as object,
        rows: rawRows as unknown as object,
        totalRows: rawRows.length,
      },
    });

    // 1a validacao — igual ao handler PUT: le de rawRows, grava normalizado em rows.
    const first = await validateRows({ rows: rawRows, mapping, organizationId });
    await prisma.importBatch.update({ where: { id: batch.id }, data: { rows: first as unknown as object } });
    expect(first[0].name).toBe('Clínica Alfa');
    expect(first[0].category).toBe('CAT1');

    // 2a validacao (releitura do banco) — deve ler rawRows de novo, nunca `rows`.
    const reloaded = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const source = (reloaded.rawRows ?? reloaded.rows) as unknown as Array<Record<string, string>>;
    const second = await validateRows({ rows: source, mapping, organizationId });

    expect(second[0].name).toBe('Clínica Alfa');
    expect(second[0].category).toBe('CAT1');
  });
});
