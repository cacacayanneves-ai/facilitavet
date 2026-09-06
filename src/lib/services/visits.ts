import type { VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Ciclo de vida da visita (secao 37).
 *
 * Marcar uma visita como realizada nao e so mudar um enum: e o evento que
 * alimenta o historico da clinica, os indicadores do mes e, no futuro, a
 * regra de "quem esta ha mais tempo sem visita" na selecao da carteira.
 */
export async function updateVisitStatus(args: {
  visitId: string;
  userId: string;
  status: VisitStatus;
  notes?: string;
  reason?: string;
}) {
  const visit = await prisma.visit.findFirst({
    where: { id: args.visitId, userId: args.userId },
    include: { clinic: true },
  });
  if (!visit) return null;

  const completedAt = args.status === 'COMPLETED' ? new Date() : null;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: args.status,
        completedAt,
        notes: args.notes ?? visit.notes,
        cancelledReason: args.status === 'CANCELLED' ? args.reason ?? null : null,
      },
      include: { clinic: true },
    });

    if (args.status === 'COMPLETED') {
      // lastVisitedAt so avanca; remarcar uma visita antiga nao pode "voltar"
      // a data mais recente da clinica.
      const current = visit.clinic.lastVisitedAt;
      if (!current || current < visit.date) {
        await tx.clinic.update({ where: { id: visit.clinicId }, data: { lastVisitedAt: visit.date } });
      }
    }

    return result;
  });

  logger.info('Status da visita atualizado', {
    scope: 'visits',
    userId: args.userId,
    visitId: visit.id,
    status: args.status,
  });

  return updated;
}

export interface MonthProgress {
  target: number;
  planned: number;
  completed: number;
  cancelled: number;
  remaining: number;
  progressPercent: number;
  availableDays: number;
  plannedDays: number;
  averagePerDay: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  perCategory: Record<'CAT1' | 'CAT2' | 'CAT3', number>;
}

/** Indicadores do mes para o dashboard. */
export async function getMonthProgress(args: {
  userId: string;
  year: number;
  month: number;
  availableDays: number;
}): Promise<MonthProgress> {
  const plan = await prisma.monthlyPlan.findUnique({
    where: { userId_year_month: { userId: args.userId, year: args.year, month: args.month } },
    include: { routes: { select: { id: true } } },
  });

  const start = new Date(Date.UTC(args.year, args.month - 1, 1));
  const end = new Date(Date.UTC(args.year, args.month, 0));

  const visits = await prisma.visit.findMany({
    where: { userId: args.userId, date: { gte: start, lte: end } },
    select: { status: true, category: true },
  });

  const perCategory = { CAT1: 0, CAT2: 0, CAT3: 0 };
  let completed = 0;
  let cancelled = 0;
  for (const visit of visits) {
    perCategory[visit.category] += 1;
    if (visit.status === 'COMPLETED') completed += 1;
    if (visit.status === 'CANCELLED') cancelled += 1;
  }

  const planned = visits.length;
  const target = plan?.targetVisits ?? 0;
  const plannedDays = plan?.routes.length ?? 0;

  return {
    target,
    planned,
    completed,
    cancelled,
    remaining: Math.max(0, target - completed),
    progressPercent: target > 0 ? Math.round((planned / target) * 100) : 0,
    availableDays: args.availableDays,
    plannedDays,
    averagePerDay: plannedDays > 0 ? Math.round((planned / plannedDays) * 10) / 10 : 0,
    totalDistanceMeters: plan?.totalDistanceMeters ?? 0,
    totalDurationSeconds: plan?.totalDurationSeconds ?? 0,
    perCategory,
  };
}

/** Histórico completo de uma clinica (secao 38). */
export async function getClinicHistory(clinicId: string, organizationId: string) {
  const clinic = await prisma.clinic.findFirst({ where: { id: clinicId, organizationId } });
  if (!clinic) return null;

  const visits = await prisma.visit.findMany({
    where: { clinicId },
    orderBy: { date: 'desc' },
    take: 50,
    include: { user: { select: { name: true } } },
  });

  const completed = visits.filter((v) => v.status === 'COMPLETED');
  const upcoming = visits
    .filter((v) => v.status === 'PLANNED' && v.date >= startOfToday())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    clinic,
    visits,
    lastVisit: completed[0] ?? null,
    previousVisit: completed[1] ?? null,
    nextVisit: upcoming[0] ?? null,
    totalCompleted: completed.length,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
