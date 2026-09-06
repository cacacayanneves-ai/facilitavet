import { Prisma, type Category, type PlanStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger, newExecutionId } from '@/lib/logger';
import { getClaudeProvider } from '@/lib/providers/claude';
import { getMapsProvider } from '@/lib/providers/maps';
import {
  generatePlan,
  type PlannedRoute,
  type PlannerClinic,
  type PlannerResult,
  type TravelMatrixRequest,
} from '@/lib/route-planner';
import { buildWorkCalendar, fromDateKey, toAvailableDays } from './calendar';
import { parseCategoryRules, resolveAnchor, toPlannerPreferences } from './settings';

export interface GeneratePlanOptions {
  userId: string;
  year: number;
  month: number;
  targetVisits?: number;
  /** Quando false, o Claude nao e consultado nesta execucao. */
  withAnalysis?: boolean;
}

export interface GeneratePlanOutcome {
  planId: string | null;
  result: PlannerResult;
  executionId: string;
  analysis: string | null;
}

/**
 * PONTE entre o motor puro e o mundo real.
 *
 * Responsabilidades desta camada (e apenas estas):
 *  - carregar carteira, configuracoes e calendario do banco;
 *  - injetar o provider de mapas como resolvedor de matriz;
 *  - persistir o resultado de forma transacional;
 *  - pedir a leitura contextual ao Claude DEPOIS de tudo decidido.
 *
 * Nenhuma decisao de roteirizacao acontece aqui.
 */
export async function generateMonthlyPlan(options: GeneratePlanOptions): Promise<GeneratePlanOutcome> {
  const executionId = newExecutionId('plan');
  const log = logger.child({ executionId, userId: options.userId, scope: 'planning' });
  const startedAt = Date.now();

  const user = await prisma.user.findUnique({
    where: { id: options.userId },
    include: { settings: true },
  });
  if (!user?.settings) throw new Error('Usuário sem configurações');

  const settings = user.settings;
  const targetVisits = options.targetVisits ?? settings.monthlyTarget;

  await prisma.planRun.create({
    data: { executionId, userId: user.id, status: 'RUNNING', mapsProvider: getMapsProvider().name },
  });

  try {
    // Clinicas ja VISITADAS neste mes nao voltam para o planejamento: o
    // trabalho ja foi feito. Replanejar deve redistribuir o que falta, nao
    // reagendar o que ja aconteceu.
    const monthStart = new Date(Date.UTC(options.year, options.month - 1, 1));
    const monthEnd = new Date(Date.UTC(options.year, options.month, 0));
    const completedVisits = await prisma.visit.findMany({
      where: {
        userId: user.id,
        status: 'COMPLETED',
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { clinicId: true },
    });
    const completedClinicIds = new Set(completedVisits.map((v) => v.clinicId));
    const remainingTarget = Math.max(0, targetVisits - completedClinicIds.size);

    const [clinics, calendar] = await Promise.all([
      prisma.clinic.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: {
          id: true,
          name: true,
          category: true,
          neighborhood: true,
          city: true,
          latitude: true,
          longitude: true,
          priority: true,
          lastVisitedAt: true,
        },
      }),
      buildWorkCalendar({
        userId: user.id,
        organizationId: user.organizationId,
        year: options.year,
        month: options.month,
        workDays: settings.workDays,
        country: settings.country,
        state: settings.state,
        city: settings.city,
      }),
    ]);

    const plannerClinics: PlannerClinic[] = clinics
      .filter((c) => !completedClinicIds.has(c.id))
      .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category as PlannerClinic['category'],
      neighborhood: c.neighborhood,
      city: c.city,
      lat: c.latitude ?? Number.NaN,
      lng: c.longitude ?? Number.NaN,
      priority: c.priority,
        lastVisitedAt: c.lastVisitedAt,
      }));

    const maps = getMapsProvider();
    const resolveMatrix = async (request: TravelMatrixRequest) => maps.travelMatrix(request);

    const origin = resolveAnchor(
      settings.originType,
      settings.originAddress,
      settings.originLatitude,
      settings.originLongitude,
    );
    const destination = resolveAnchor(
      settings.destinationType,
      settings.destinationAddress,
      settings.destinationLatitude,
      settings.destinationLongitude,
    );

    if (completedClinicIds.size > 0) {
      log.info('Replanejamento parcial', {
        alreadyCompleted: completedClinicIds.size,
        remainingTarget,
      });
    }

    const result = await generatePlan(
      {
        clinics: plannerClinics,
        availableDays: toAvailableDays(calendar),
        monthlyTarget: remainingTarget,
        month: options.month,
        year: options.year,
        origin,
        destination,
        categoryRules: parseCategoryRules(settings.categoryRules),
        preferences: toPlannerPreferences(settings, seedFor(user.id, options.year, options.month)),
        resolveMatrix,
      },
      { executionId },
    );

    log.info('Plano calculado', {
      feasible: result.feasibility.feasible,
      visits: result.statistics.selectedVisits,
      days: result.statistics.plannedDays,
      distanceKm: Math.round(result.statistics.totalDistanceMeters / 1000),
      strategy: result.statistics.strategy,
      durationMs: result.statistics.durationMs,
    });

    if (!result.feasibility.feasible) {
      await prisma.planRun.update({
        where: { executionId },
        data: { status: 'INFEASIBLE', durationMs: Date.now() - startedAt, logs: result.feasibility as unknown as object },
      });
      return { planId: null, result, executionId, analysis: null };
    }

    const planId = await persistPlan({
      userId: user.id,
      organizationId: user.organizationId,
      year: options.year,
      month: options.month,
      targetVisits,
      result,
      matrixProvider: maps.name,
    });

    // O Claude entra AQUI: depois que o plano ja existe e esta persistido.
    let analysis: string | null = null;
    if (options.withAnalysis !== false) {
      analysis = await buildMonthAnalysis(result, options.month, options.year);
      if (analysis) {
        await prisma.monthlyPlan.update({
          where: { id: planId },
          data: { statistics: { ...(result.statistics as unknown as object), analysis } },
        });
      }
    }

    await prisma.planRun.update({
      where: { executionId },
      data: {
        status: 'SUCCESS',
        monthlyPlanId: planId,
        strategy: result.statistics.strategy,
        durationMs: Date.now() - startedAt,
        mapsProvider: result.statistics.matrixProvider,
        matrixElements: result.statistics.matrixElements,
        cacheHits: maps.stats.matrixHits,
        claudeUsed: Boolean(analysis),
        logs: { warnings: result.warnings } as unknown as object,
      },
    });

    return { planId, result, executionId, analysis };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Falha ao gerar plano', { error: message });
    await prisma.planRun
      .update({
        where: { executionId },
        data: { status: 'FAILED', error: message, durationMs: Date.now() - startedAt },
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Persiste plano, rotas, paradas e visitas em UMA transacao.
 *
 * Regenerar um mes descarta o planejamento anterior, mas NUNCA o trabalho
 * realizado. Visitas concluidas permanecem no historico e sao reanexadas ao
 * plano novo — as clinicas correspondentes ja foram excluidas do pool do
 * motor, entao nao ha risco de contar a mesma visita duas vezes.
 */
async function persistPlan(args: {
  userId: string;
  organizationId: string;
  year: number;
  month: number;
  targetVisits: number;
  result: PlannerResult;
  matrixProvider: string;
}): Promise<string> {
  const { userId, organizationId, year, month, targetVisits, result } = args;

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.monthlyPlan.findUnique({
        where: { userId_year_month: { userId, year, month } },
        include: { visits: { where: { status: { in: ['COMPLETED', 'CANCELLED'] } } } },
      });

      const preservedVisitIds = existing?.visits.map((v) => v.id) ?? [];

      if (existing) {
        // Desanexa temporariamente o que foi realizado/cancelado para que o
        // delete em cascata do plano nao leve o historico junto.
        await tx.visit.updateMany({
          where: { id: { in: preservedVisitIds } },
          data: { monthlyPlanId: null },
        });
        await tx.visit.deleteMany({ where: { monthlyPlanId: existing.id } });
        await tx.monthlyPlan.delete({ where: { id: existing.id } });
      }

      const plan = await tx.monthlyPlan.create({
        data: {
          organizationId,
          userId,
          year,
          month,
          targetVisits,
          status: 'READY' as PlanStatus,
          requiredCategories: result.statistics.requiredCategories as Category[],
          totalDistanceMeters: result.statistics.totalDistanceMeters,
          totalDurationSeconds: result.statistics.totalDurationSeconds,
          averageScore: result.statistics.averageScore,
          statistics: result.statistics as unknown as object,
          inputSnapshot: {
            targetVisits,
            availableDays: result.routes.length,
            warnings: result.warnings,
          } as unknown as object,
          generatedAt: new Date(),
        },
      });

      for (const route of result.routes) {
        if (route.stops.length === 0) continue;
        const date = fromDateKey(route.date);

        const createdRoute = await tx.route.create({
          data: {
            monthlyPlanId: plan.id,
            date,
            originLabel: route.originLabel,
            originLatitude: route.origin?.lat ?? null,
            originLongitude: route.origin?.lng ?? null,
            destinationLabel: route.destinationLabel,
            destinationLatitude: route.destination?.lat ?? null,
            destinationLongitude: route.destination?.lng ?? null,
            totalDistanceMeters: route.totalDistanceMeters,
            totalDurationSeconds: route.totalDurationSeconds,
            score: route.score,
            scoreBreakdown: route.scoreBreakdown as unknown as object,
            regionLabel: route.regionLabel,
            matrixProvider: args.matrixProvider,
            estimatedAt: new Date(),
          },
        });

        for (const stop of route.stops) {
          const visit = await tx.visit.create({
            data: {
              organizationId,
              userId,
              clinicId: stop.clinicId,
              monthlyPlanId: plan.id,
              date,
              category: stop.category as Category,
              status: 'PLANNED',
              sequence: stop.sequence,
              estimatedArrival: combineDateAndTime(route.date, stop.estimatedArrival),
            },
          });

          await tx.routeStop.create({
            data: {
              routeId: createdRoute.id,
              clinicId: stop.clinicId,
              visitId: visit.id,
              sequence: stop.sequence,
              estimatedArrival: combineDateAndTime(route.date, stop.estimatedArrival),
              estimatedDeparture: combineDateAndTime(route.date, stop.estimatedDeparture),
              distanceFromPreviousMeters: stop.distanceFromPreviousMeters,
              durationFromPreviousSeconds: stop.durationFromPreviousSeconds,
            },
          });
        }
      }

      // Reanexa o historico ao plano recem-criado.
      if (preservedVisitIds.length > 0) {
        await tx.visit.updateMany({
          where: { id: { in: preservedVisitIds } },
          data: { monthlyPlanId: plan.id },
        });
      }

      return plan.id;
    },
    { timeout: 60_000, maxWait: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export function combineDateAndTime(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00.000Z`);
}

/** Semente estavel por usuario/mes: regenerar o mesmo mes da o mesmo plano. */
function seedFor(userId: string, year: number, month: number): number {
  let hash = 2166136261;
  for (const char of `${userId}:${year}-${month}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 2147483647;
}

async function buildMonthAnalysis(
  result: PlannerResult,
  month: number,
  year: number,
): Promise<string | null> {
  const claude = getClaudeProvider();
  if (!claude.available) return null;

  const regions = new Map<string, number>();
  for (const route of result.routes) {
    if (!route.regionLabel) continue;
    regions.set(route.regionLabel, (regions.get(route.regionLabel) ?? 0) + route.stops.length);
  }

  const analysis = await claude.analyzeMonth({
    month,
    year,
    totalVisits: result.statistics.selectedVisits,
    plannedDays: result.statistics.plannedDays,
    totalDistanceKm: Math.round(result.statistics.totalDistanceMeters / 1000),
    totalDurationHours: Math.round((result.statistics.totalDurationSeconds / 3600) * 10) / 10,
    averageScore: result.statistics.averageScore,
    requiredCategories: result.statistics.requiredCategories,
    estimated: result.statistics.estimated,
    savingPercent: result.statistics.baseline?.distanceSavingPercent ?? null,
    busiestRegions: [...regions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([region, visits]) => ({ region, visits })),
    warnings: result.warnings.map((w) => w.message),
  });

  return analysis?.summary ?? null;
}

/** Analise contextual de um dia especifico, sob demanda. */
export async function analyzeRoute(routeId: string): Promise<string | null> {
  const claude = getClaudeProvider();
  if (!claude.available) return null;

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { stops: true, monthlyPlan: true },
  });
  if (!route) return null;

  const breakdown = (route.scoreBreakdown ?? {}) as {
    backtracking?: number;
    concentrationMeters?: number;
  };
  const statistics = (route.monthlyPlan.statistics ?? {}) as {
    candidates?: Array<{ strategy: string; totalDistanceMeters: number; totalDurationSeconds: number; averageScore: number }>;
  };

  const analysis = await claude.analyzeRoute({
    date: route.date.toISOString().slice(0, 10),
    requiredVisits: route.stops.length,
    origin: route.originLabel,
    destination: route.destinationLabel,
    regionLabel: route.regionLabel ?? '',
    estimated: route.matrixProvider === 'offline-geometric',
    candidates: [
      {
        label: 'rota escolhida',
        distanceKm: Math.round(route.totalDistanceMeters / 100) / 10,
        durationMinutes: Math.round(route.totalDurationSeconds / 60),
        backtracking: breakdown.backtracking ?? 0,
        concentrationKm: Math.round((breakdown.concentrationMeters ?? 0) / 100) / 10,
        score: route.score,
      },
      ...(statistics.candidates ?? []).slice(1, 3).map((c) => ({
        label: c.strategy,
        distanceKm: Math.round(c.totalDistanceMeters / 100) / 10,
        durationMinutes: Math.round(c.totalDurationSeconds / 60),
        backtracking: 0,
        concentrationKm: 0,
        score: c.averageScore,
      })),
    ],
  });

  if (analysis?.summary) {
    await prisma.route.update({ where: { id: routeId }, data: { aiSummary: analysis.summary } });
  }
  return analysis?.summary ?? null;
}

export { PlanStatus };
