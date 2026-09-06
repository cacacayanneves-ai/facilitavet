import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getMapsProvider } from '@/lib/providers/maps';
import {
  DEFAULT_PREFERENCES,
  recalculateRoute,
  suggestAlternatives,
  type PlannerClinic,
} from '@/lib/route-planner';
import { combineDateAndTime } from './planning';
import { toPlannerPreferences } from './settings';

/**
 * Edicao manual do roteiro (secoes 30 e 31).
 *
 * Reordenar ou trocar uma clinica NAO e um update cosmetico: distancias,
 * horarios, score e mapa precisam refletir a nova realidade. Por isso toda
 * edicao passa pelo mesmo motor que gerou a rota original.
 */

export async function loadRouteContext(routeId: string, userId: string) {
  const route = await prisma.route.findFirst({
    where: { id: routeId, monthlyPlan: { userId } },
    include: {
      stops: { orderBy: { sequence: 'asc' }, include: { clinic: true, visit: true } },
      monthlyPlan: true,
    },
  });
  if (!route) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { settings: true } });
  if (!user?.settings) return null;

  return { route, user, settings: user.settings };
}

function toPlannerClinic(clinic: {
  id: string;
  name: string;
  category: string;
  neighborhood: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}): PlannerClinic {
  return {
    id: clinic.id,
    name: clinic.name,
    category: clinic.category as PlannerClinic['category'],
    neighborhood: clinic.neighborhood,
    city: clinic.city,
    lat: clinic.latitude ?? Number.NaN,
    lng: clinic.longitude ?? Number.NaN,
  };
}

export interface ReorderResult {
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  score: number;
  stops: Array<{ clinicId: string; sequence: number; estimatedArrival: string; distanceFromPreviousMeters: number }>;
}

/** Aplica uma nova ordem (arrastar e soltar) e recalcula tudo. */
export async function reorderRoute(args: {
  routeId: string;
  userId: string;
  clinicIdsInOrder: string[];
  /** Quando true, ignora a ordem enviada e reotimiza do zero. */
  reoptimize?: boolean;
}): Promise<ReorderResult | null> {
  const context = await loadRouteContext(args.routeId, args.userId);
  if (!context) return null;
  const { route, settings } = context;

  const byId = new Map(route.stops.map((s) => [s.clinicId, s.clinic]));
  const ordered = args.clinicIdsInOrder
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (ordered.length !== route.stops.length) {
    throw new Error('A nova ordem precisa conter exatamente as mesmas clinicas da rota.');
  }

  return applyRoute({
    routeId: route.id,
    dateKey: route.date.toISOString().slice(0, 10),
    clinics: ordered.map(toPlannerClinic),
    origin: route.originLatitude !== null && route.originLongitude !== null
      ? { lat: route.originLatitude, lng: route.originLongitude }
      : null,
    destination: route.destinationLatitude !== null && route.destinationLongitude !== null
      ? { lat: route.destinationLatitude, lng: route.destinationLongitude }
      : null,
    settings,
    keepOrder: !args.reoptimize,
  });
}

/** Troca uma clinica da rota por outra da carteira e recalcula. */
export async function swapStop(args: {
  routeId: string;
  userId: string;
  sequence: number;
  replacementClinicId: string;
}): Promise<ReorderResult | null> {
  const context = await loadRouteContext(args.routeId, args.userId);
  if (!context) return null;
  const { route, settings, user } = context;

  const replacement = await prisma.clinic.findFirst({
    where: { id: args.replacementClinicId, organizationId: user.organizationId, active: true },
  });
  if (!replacement) throw new Error('Clinica substituta nao encontrada na carteira.');
  if (replacement.latitude === null || replacement.longitude === null) {
    throw new Error('A clinica substituta esta sem localizacao definida.');
  }
  if (route.stops.some((s) => s.clinicId === replacement.id)) {
    throw new Error('Essa clinica ja esta nesta rota.');
  }

  const clinics = route.stops.map((stop) =>
    stop.sequence === args.sequence ? toPlannerClinic(replacement) : toPlannerClinic(stop.clinic),
  );

  return applyRoute({
    routeId: route.id,
    dateKey: route.date.toISOString().slice(0, 10),
    clinics,
    origin: route.originLatitude !== null && route.originLongitude !== null
      ? { lat: route.originLatitude, lng: route.originLongitude }
      : null,
    destination: route.destinationLatitude !== null && route.destinationLongitude !== null
      ? { lat: route.destinationLatitude, lng: route.destinationLongitude }
      : null,
    settings,
    keepOrder: false,
  });
}

/** Alternativas proximas para substituir uma parada. */
export async function alternativesForStop(args: {
  routeId: string;
  userId: string;
  sequence: number;
  limit?: number;
}) {
  const context = await loadRouteContext(args.routeId, args.userId);
  if (!context) return null;
  const { route, user } = context;

  // Nao sugerimos clinicas ja planejadas no mesmo mes: trocar por outra que ja
  // esta agendada nao resolve nada, so move o problema de dia.
  const plannedThisMonth = await prisma.visit.findMany({
    where: { monthlyPlanId: route.monthlyPlanId },
    select: { clinicId: true },
  });
  const excluded = new Set(plannedThisMonth.map((v) => v.clinicId));

  const pool = await prisma.clinic.findMany({
    where: {
      organizationId: user.organizationId,
      active: true,
      latitude: { not: null },
      longitude: { not: null },
      id: { notIn: [...excluded] },
    },
    take: 400,
  });

  return suggestAlternatives({
    route: {
      stops: route.stops.map((s) => ({
        clinicId: s.clinicId,
        lat: s.clinic.latitude ?? 0,
        lng: s.clinic.longitude ?? 0,
      })),
      origin:
        route.originLatitude !== null && route.originLongitude !== null
          ? { lat: route.originLatitude, lng: route.originLongitude }
          : null,
      destination:
        route.destinationLatitude !== null && route.destinationLongitude !== null
          ? { lat: route.destinationLatitude, lng: route.destinationLongitude }
          : null,
    },
    replaceSequence: args.sequence,
    pool: pool.map(toPlannerClinic),
    limit: args.limit ?? 6,
  }).map((item) => ({
    clinicId: item.clinic.id,
    name: item.clinic.name,
    neighborhood: item.clinic.neighborhood,
    category: item.clinic.category,
    extraMinutes: Math.round(item.extraSeconds / 60),
    extraMeters: item.extraMeters,
  }));
}

/** Recalcula e grava a rota — usado por reorder e swap. */
async function applyRoute(args: {
  routeId: string;
  dateKey: string;
  clinics: PlannerClinic[];
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  settings: Parameters<typeof toPlannerPreferences>[0];
  keepOrder: boolean;
}): Promise<ReorderResult> {
  const maps = getMapsProvider();

  const recalculated = await recalculateRoute({
    date: args.dateKey,
    clinics: args.clinics,
    origin: args.origin,
    destination: args.destination,
    input: {
      preferences: toPlannerPreferences(args.settings, DEFAULT_PREFERENCES.seed),
      origin: null,
      destination: null,
      resolveMatrix: async (request) => maps.travelMatrix(request),
    },
    keepOrder: args.keepOrder,
  });

  await prisma.$transaction(async (tx) => {
    await tx.route.update({
      where: { id: args.routeId },
      data: {
        totalDistanceMeters: recalculated.totalDistanceMeters,
        totalDurationSeconds: recalculated.totalDurationSeconds,
        score: recalculated.score,
        scoreBreakdown: recalculated.scoreBreakdown as unknown as object,
        regionLabel: recalculated.regionLabel,
        matrixProvider: maps.name,
        estimatedAt: new Date(),
        stale: false,
        // A analise antiga descreve uma rota que nao existe mais.
        aiSummary: null,
      },
    });

    const existing = await tx.routeStop.findMany({ where: { routeId: args.routeId } });
    const visitIdByClinic = new Map(existing.map((s) => [s.clinicId, s.visitId]));
    const route = await tx.route.findUniqueOrThrow({ where: { id: args.routeId } });

    await tx.routeStop.deleteMany({ where: { routeId: args.routeId } });

    for (const stop of recalculated.stops) {
      const arrival = combineDateAndTime(args.dateKey, stop.estimatedArrival);
      const visitId = visitIdByClinic.get(stop.clinicId) ?? null;

      await tx.routeStop.create({
        data: {
          routeId: args.routeId,
          clinicId: stop.clinicId,
          visitId,
          sequence: stop.sequence,
          estimatedArrival: arrival,
          estimatedDeparture: combineDateAndTime(args.dateKey, stop.estimatedDeparture),
          distanceFromPreviousMeters: stop.distanceFromPreviousMeters,
          durationFromPreviousSeconds: stop.durationFromPreviousSeconds,
        },
      });

      if (visitId) {
        await tx.visit.update({
          where: { id: visitId },
          data: { sequence: stop.sequence, estimatedArrival: arrival, clinicId: stop.clinicId },
        });
      } else {
        // Clinica nova entrou pela troca: cria a visita correspondente.
        const created = await tx.visit.create({
          data: {
            organizationId: (await tx.monthlyPlan.findUniqueOrThrow({ where: { id: route.monthlyPlanId } })).organizationId,
            userId: (await tx.monthlyPlan.findUniqueOrThrow({ where: { id: route.monthlyPlanId } })).userId,
            clinicId: stop.clinicId,
            monthlyPlanId: route.monthlyPlanId,
            date: route.date,
            category: stop.category,
            sequence: stop.sequence,
            estimatedArrival: arrival,
          },
        });
        await tx.routeStop.updateMany({
          where: { routeId: args.routeId, clinicId: stop.clinicId },
          data: { visitId: created.id },
        });
      }
    }

    // Visitas orfas (clinica removida pela troca) saem do plano.
    const keptClinicIds = recalculated.stops.map((s) => s.clinicId);
    await tx.visit.deleteMany({
      where: {
        monthlyPlanId: route.monthlyPlanId,
        date: route.date,
        status: 'PLANNED',
        clinicId: { notIn: keptClinicIds },
      },
    });

    await refreshPlanTotals(tx, route.monthlyPlanId);
  });

  logger.info('Rota recalculada', {
    scope: 'routes',
    routeId: args.routeId,
    keepOrder: args.keepOrder,
    distanceKm: Math.round(recalculated.totalDistanceMeters / 100) / 10,
  });

  return {
    totalDistanceMeters: recalculated.totalDistanceMeters,
    totalDurationSeconds: recalculated.totalDurationSeconds,
    score: recalculated.score,
    stops: recalculated.stops.map((s) => ({
      clinicId: s.clinicId,
      sequence: s.sequence,
      estimatedArrival: s.estimatedArrival,
      distanceFromPreviousMeters: s.distanceFromPreviousMeters,
    })),
  };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Recalcula os totais do mes a partir das rotas. */
export async function refreshPlanTotals(tx: TxClient, monthlyPlanId: string): Promise<void> {
  const routes = await tx.route.findMany({ where: { monthlyPlanId } });
  const totalDistance = routes.reduce((sum, r) => sum + r.totalDistanceMeters, 0);
  const totalDuration = routes.reduce((sum, r) => sum + r.totalDurationSeconds, 0);
  const scored = routes.filter((r) => r.score > 0);
  const averageScore = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0;

  await tx.monthlyPlan.update({
    where: { id: monthlyPlanId },
    data: {
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      averageScore: Math.round(averageScore * 10) / 10,
    },
  });
}
