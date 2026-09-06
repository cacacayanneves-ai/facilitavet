import { prisma } from '@/lib/db';
import type { CurrentUser } from '@/lib/auth';
import { buildWorkCalendar, fromDateKey, toDateKey } from './calendar';
import { getMonthProgress } from './visits';
import { parseCategoryRules } from './settings';
import { requiredCategoriesFor } from '@/lib/route-planner';

/**
 * Consulta unica que alimenta o dashboard.
 *
 * Concentrada aqui para que a pagina seja um componente de servidor magro: ela
 * renderiza, nao consulta. Tambem evita o padrao de 8 queries encadeadas por
 * card, que e o que costuma tornar dashboards lentos.
 */
export async function getDashboardData(user: CurrentUser, reference = new Date()) {
  const settings = user.settings!;
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;
  const today = toDateKey(reference);

  const [calendar, plan, todayRoute, upcomingRoutes, nextRoute, clinicStats] = await Promise.all([
    buildWorkCalendar({
      userId: user.id,
      organizationId: user.organizationId,
      year,
      month,
      workDays: settings.workDays,
      country: settings.country,
      state: settings.state,
      city: settings.city,
    }),
    prisma.monthlyPlan.findUnique({
      where: { userId_year_month: { userId: user.id, year, month } },
    }),
    prisma.route.findFirst({
      where: { date: fromDateKey(today), monthlyPlan: { userId: user.id } },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: { clinic: true, visit: true },
        },
      },
    }),
    prisma.route.findMany({
      where: { date: { gt: fromDateKey(today) }, monthlyPlan: { userId: user.id } },
      orderBy: { date: 'asc' },
      take: 4,
      include: { _count: { select: { stops: true } } },
    }),
    // Proxima jornada completa: alimenta o painel "Hoje" quando o dia atual
    // e fim de semana ou feriado, para que a tela nunca abra vazia.
    prisma.route.findFirst({
      where: { date: { gt: fromDateKey(today) }, monthlyPlan: { userId: user.id } },
      orderBy: { date: 'asc' },
      include: { stops: { orderBy: { sequence: 'asc' }, include: { clinic: true, visit: true } } },
    }),
    prisma.clinic.groupBy({
      by: ['category'],
      where: { organizationId: user.organizationId, active: true },
      _count: true,
    }),
  ]);

  const availableDays = calendar.filter((d) => d.available).length;
  const progress = await getMonthProgress({ userId: user.id, year, month, availableDays });

  const statistics = (plan?.statistics ?? null) as {
    baseline?: { distanceSavingPercent: number; durationSavingSeconds: number };
    estimated?: boolean;
    analysis?: string;
    matrixProvider?: string;
  } | null;

  const requiredCategories = requiredCategoriesFor(
    parseCategoryRules(settings.categoryRules),
    year,
    month,
  );

  return {
    year,
    month,
    today,
    calendar,
    plan,
    statistics,
    progress,
    todayRoute,
    upcomingRoutes,
    nextRoute,
    availableDays,
    requiredCategories,
    clinicsByCategory: Object.fromEntries(clinicStats.map((c) => [c.category, c._count])) as Record<
      string,
      number
    >,
    estimated: statistics?.estimated ?? true,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
