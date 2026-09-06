import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildWorkCalendar } from '@/lib/services/calendar';
import { parseCategoryRules } from '@/lib/services/settings';
import { categoryForecast, evaluateFeasibility } from '@/lib/route-planner';
import { Topbar } from '@/components/layout/topbar';
import { PlanningWorkspace } from './planning-workspace';

export const metadata = { title: 'Planejamento' };
export const dynamic = 'force-dynamic';

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const user = await requireUser();
  const settings = user.settings!;
  const params = await searchParams;

  const now = new Date();
  const year = Number.parseInt(params.year ?? '', 10) || now.getUTCFullYear();
  const month = Number.parseInt(params.month ?? '', 10) || now.getUTCMonth() + 1;

  const rules = parseCategoryRules(settings.categoryRules);

  const [calendar, plan, clinicCounts, locatedCount] = await Promise.all([
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
    prisma.monthlyPlan.findUnique({ where: { userId_year_month: { userId: user.id, year, month } } }),
    prisma.clinic.groupBy({
      by: ['category'],
      where: { organizationId: user.organizationId, active: true },
      _count: true,
    }),
    prisma.clinic.count({
      where: {
        organizationId: user.organizationId,
        active: true,
        latitude: { not: null },
        longitude: { not: null },
      },
    }),
  ]);

  const availableDays = calendar.filter((d) => d.available).length;
  const forecast = categoryForecast(rules, year, month, 6);
  const requiredCategories = forecast[0].categories;

  // Quantas visitas o mes realmente EXIGE, dado o ciclo e o tamanho da carteira.
  const byCategory = Object.fromEntries(clinicCounts.map((c) => [c.category, c._count])) as Record<string, number>;
  const requiredVisits = Math.min(
    settings.monthlyTarget,
    requiredCategories.reduce(
      (sum, category) => sum + Math.min(rules.rules[category]?.targetCount ?? 0, byCategory[category] ?? 0),
      0,
    ),
  );

  const feasibility = evaluateFeasibility(
    Math.max(requiredVisits, Math.min(settings.monthlyTarget, locatedCount)),
    availableDays,
    settings.minVisitsPerDay,
    settings.maxVisitsPerDay,
  );

  return (
    <>
      <Topbar title="Planejamento" subtitle="Monte o mês inteiro em segundos" />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PlanningWorkspace
          year={year}
          month={month}
          monthlyTarget={settings.monthlyTarget}
          minPerDay={settings.minVisitsPerDay}
          maxPerDay={settings.maxVisitsPerDay}
          calendar={calendar}
          availableDays={availableDays}
          forecast={forecast}
          clinicsByCategory={byCategory}
          locatedCount={locatedCount}
          categoryTargets={{
            CAT1: rules.rules.CAT1.targetCount,
            CAT2: rules.rules.CAT2.targetCount,
            CAT3: rules.rules.CAT3.targetCount,
          }}
          feasibility={feasibility}
          existingPlan={
            plan
              ? {
                  id: plan.id,
                  generatedAt: plan.generatedAt?.toISOString() ?? null,
                  targetVisits: plan.targetVisits,
                  totalDistanceMeters: plan.totalDistanceMeters,
                  totalDurationSeconds: plan.totalDurationSeconds,
                  averageScore: plan.averageScore,
                  statistics: plan.statistics as Record<string, unknown> | null,
                }
              : null
          }
        />
      </main>
    </>
  );
}
