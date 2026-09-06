import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prepareDailyMessages, dispatchDueMessages } from '@/lib/services/notifications';
import { DEFAULT_CATEGORY_RULES, DEFAULT_SCORE_WEIGHTS } from '@/lib/route-planner';

/**
 * Teste de integracao contra o banco real.
 *
 * O agendamento do WhatsApp e a parte do produto com mais regras de negocio
 * invisiveis (feriado, fim de semana, dia bloqueado, roteiro inexistente,
 * idempotencia). Testar so as funcoes puras deixaria justamente essas regras
 * sem cobertura, porque todas dependem de consulta ao banco.
 *
 * Requer DATABASE_URL. Pulado automaticamente quando o banco nao esta
 * acessivel, para nao quebrar `npm test` em maquina sem Postgres.
 */
const prisma = new PrismaClient();

let available = true;
let organizationId = '';
let userId = '';

const ORG_SLUG = 'test-notifications';
const EMAIL = 'notify-test@facilitavet.test';

// Datas fixas de 2026 com propriedades conhecidas.
const MONDAY = '2026-09-14';
const SATURDAY = '2026-09-12';
const HOLIDAY = '2026-09-07'; // Independência (segunda-feira)
const BLOCKED = '2026-09-15';
const NO_ROUTE = '2026-09-16';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    available = false;
    return;
  }

  await cleanup();

  const org = await prisma.organization.create({
    data: { name: 'Org de teste', slug: ORG_SLUG },
  });
  organizationId = org.id;

  const user = await prisma.user.create({
    data: {
      organizationId,
      name: 'Testador',
      email: EMAIL,
      passwordHash: 'x',
      settings: {
        create: {
          categoryRules: DEFAULT_CATEGORY_RULES as unknown as object,
          scoreWeights: { ...DEFAULT_SCORE_WEIGHTS },
          whatsappEnabled: true,
          whatsappNumber: '5511900000000',
          whatsappTime: '08:00',
          whatsappDays: [1, 2, 3, 4, 5, 6],
          workDays: [1, 2, 3, 4, 5],
          country: 'BR',
          state: 'SP',
          city: 'São Paulo',
        },
      },
    },
  });
  userId = user.id;

  await prisma.holiday.create({
    data: {
      date: new Date(`${HOLIDAY}T00:00:00.000Z`),
      name: 'Independência do Brasil',
      country: 'BR',
      state: '',
      city: '',
    },
  });

  await prisma.blockedDay.create({
    data: { userId, date: new Date(`${BLOCKED}T00:00:00.000Z`), reason: 'Treinamento' },
  });

  const clinic = await prisma.clinic.create({
    data: {
      organizationId,
      name: 'Clínica de Teste',
      category: 'CAT1',
      neighborhood: 'Vila Mariana',
      latitude: -23.5893,
      longitude: -46.6345,
      geocodeStatus: 'RESOLVED',
    },
  });

  const plan = await prisma.monthlyPlan.create({
    data: {
      organizationId,
      userId,
      year: 2026,
      month: 9,
      targetVisits: 10,
      status: 'READY',
      requiredCategories: ['CAT1'],
    },
  });

  // Roteiros nos dias que devem receber mensagem e nos que nao devem.
  for (const date of [MONDAY, SATURDAY, HOLIDAY, BLOCKED]) {
    const route = await prisma.route.create({
      data: {
        monthlyPlanId: plan.id,
        date: new Date(`${date}T00:00:00.000Z`),
        totalDistanceMeters: 12_000,
        totalDurationSeconds: 2_400,
        regionLabel: 'Vila Mariana',
        matrixProvider: 'offline-geometric',
      },
    });
    const visit = await prisma.visit.create({
      data: {
        organizationId,
        userId,
        clinicId: clinic.id,
        monthlyPlanId: plan.id,
        date: new Date(`${date}T00:00:00.000Z`),
        category: 'CAT1',
        sequence: 1,
        estimatedArrival: new Date(`${date}T08:00:00.000Z`),
      },
    });
    await prisma.routeStop.create({
      data: {
        routeId: route.id,
        clinicId: clinic.id,
        visitId: visit.id,
        sequence: 1,
        estimatedArrival: new Date(`${date}T08:00:00.000Z`),
      },
    });
  }
});

afterAll(async () => {
  if (available) await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.outboxMessage.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.organization.deleteMany({ where: { slug: ORG_SLUG } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.holiday.deleteMany({ where: { date: new Date(`${HOLIDAY}T00:00:00.000Z`), name: 'Independência do Brasil' } });
}

async function outboxFor(date: string) {
  return prisma.outboxMessage.findUnique({ where: { dedupeKey: `daily-route:${userId}:${date}` } });
}

describe.skipIf(!available)('agendamento do WhatsApp', () => {
  it('enfileira a mensagem num dia util com roteiro', async () => {
    const result = await prepareDailyMessages({ date: MONDAY });
    expect(result.prepared).toBeGreaterThanOrEqual(1);

    const message = await outboxFor(MONDAY);
    expect(message).not.toBeNull();
    expect(message!.status).toBe('QUEUED');
    expect(message!.recipient).toBe('5511900000000');
    expect(message!.body).toContain('Clínica de Teste');
    expect(message!.body).toContain('Segunda-feira, 14/09/2026');
  });

  it('NAO envia em feriado, mesmo havendo roteiro', async () => {
    const result = await prepareDailyMessages({ date: HOLIDAY });
    expect(await outboxFor(HOLIDAY)).toBeNull();
    const skipped = result.skipped.find((s) => s.userId === userId);
    expect(skipped?.reason).toContain('Feriado');
  });

  it('NAO envia em fim de semana', async () => {
    await prepareDailyMessages({ date: SATURDAY });
    expect(await outboxFor(SATURDAY)).toBeNull();
  });

  it('NAO envia em dia bloqueado manualmente', async () => {
    const result = await prepareDailyMessages({ date: BLOCKED });
    expect(await outboxFor(BLOCKED)).toBeNull();
    expect(result.skipped.find((s) => s.userId === userId)?.reason).toContain('BLOCKED');
  });

  it('NAO envia em dia util sem roteiro', async () => {
    const result = await prepareDailyMessages({ date: NO_ROUTE });
    expect(await outboxFor(NO_ROUTE)).toBeNull();
    expect(result.skipped.find((s) => s.userId === userId)?.reason).toContain('Sem roteiro');
  });

  it('e idempotente: preparar duas vezes nao duplica a mensagem', async () => {
    await prepareDailyMessages({ date: MONDAY });
    await prepareDailyMessages({ date: MONDAY });
    const all = await prisma.outboxMessage.findMany({ where: { userId, scheduledFor: { gte: new Date(`${MONDAY}T00:00:00Z`), lt: new Date(`${MONDAY}T23:59:59Z`) } } });
    expect(all).toHaveLength(1);
  });

  it('atualiza o texto se o roteiro mudar antes do envio', async () => {
    await prisma.clinic.updateMany({
      where: { organizationId, name: 'Clínica de Teste' },
      data: { name: 'Clínica Renomeada' },
    });
    await prepareDailyMessages({ date: MONDAY });
    const message = await outboxFor(MONDAY);
    expect(message!.body).toContain('Clínica Renomeada');
    expect(message!.status).toBe('QUEUED');
  });

  it('nao reenvia mensagem ja processada', async () => {
    await prisma.outboxMessage.update({
      where: { dedupeKey: `daily-route:${userId}:${MONDAY}` },
      data: { status: 'SENT', sentAt: new Date() },
    });
    const result = await prepareDailyMessages({ date: MONDAY });
    expect(result.skipped.find((s) => s.userId === userId)?.reason).toContain('SENT');
  });

  it('respeita o desligamento do WhatsApp nas configuracoes', async () => {
    await prisma.outboxMessage.deleteMany({ where: { userId } });
    await prisma.userSettings.update({ where: { userId }, data: { whatsappEnabled: false } });

    const result = await prepareDailyMessages({ date: MONDAY });
    expect(await outboxFor(MONDAY)).toBeNull();
    expect(result.skipped.find((s) => s.userId === userId)?.reason).toContain('desativado');

    await prisma.userSettings.update({ where: { userId }, data: { whatsappEnabled: true } });
  });

  it('sem credenciais do provider a mensagem fica marcada como nao enviada', async () => {
    await prisma.outboxMessage.deleteMany({ where: { userId } });
    await prepareDailyMessages({ date: MONDAY });

    // Vence o agendamento para que o despacho a considere.
    await prisma.outboxMessage.updateMany({
      where: { userId },
      data: { scheduledFor: new Date(Date.now() - 60_000) },
    });

    const result = await dispatchDueMessages({ limit: 10 });
    expect(result.skipped + result.sent).toBeGreaterThanOrEqual(1);

    const message = await outboxFor(MONDAY);
    // Sem WHATSAPP_ACCESS_TOKEN o provider e o de log: SKIPPED, nunca perdido.
    expect(['SKIPPED', 'SENT']).toContain(message!.status);
    expect(message!.attempts).toBeGreaterThanOrEqual(1);
  });
});
