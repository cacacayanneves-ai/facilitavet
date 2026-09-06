import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildWorkCalendar } from '@/lib/services/calendar';
import { parseCategoryRules } from '@/lib/services/settings';
import { categoryForecast, evaluateFeasibility, expandSplitClinics, type PlannerClinic } from '@/lib/route-planner';
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

  const [calendar, plan, clinicStats, activeClinics] = await Promise.all([
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
    // Contagem de CLINICAS por categoria (exibida na tela) — nao confundir com
    // visitas: a meta e a viabilidade contam veterinarios, computados abaixo.
    prisma.clinic.groupBy({
      by: ['category'],
      where: { organizationId: user.organizationId, active: true },
      _count: true,
      _sum: { veterinarians: true },
    }),
    prisma.clinic.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        latitude: { not: null },
        longitude: { not: null },
      },
      select: { id: true, name: true, category: true, veterinarians: true, visitSplits: true },
    }),
  ]);

  const availableDays = calendar.filter((d) => d.available).length;
  const forecast = categoryForecast(rules, year, month, 6);
  const requiredCategories = forecast[0].categories;

  // Clinicas por categoria (exibicao) e visitas (veterinarios) disponiveis por
  // categoria (matematica da meta) — sao numeros diferentes de proposito.
  const byCategory = Object.fromEntries(clinicStats.map((c) => [c.category, c._count])) as Record<string, number>;
  const visitsByCategory = Object.fromEntries(
    clinicStats.map((c) => [c.category, c._sum.veterinarians ?? 0]),
  ) as Record<string, number>;

  const requiredVisits = Math.min(
    settings.monthlyTarget,
    requiredCategories.reduce(
      (sum, category) => sum + Math.min(rules.rules[category]?.targetCount ?? 0, visitsByCategory[category] ?? 0),
      0,
    ),
  );

  // Roda a MESMA verificacao de viabilidade do motor (incluindo o caso de
  // clinicas cujo numero de veterinarios sozinho estoura o limite diario),
  // para que esta previa nunca diga "viavel" quando o planejamento real nao
  // conseguiria gerar o mes.
  const eligibleClinics: PlannerClinic[] = activeClinics
    .filter((c) => requiredCategories.includes(c.category))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      veterinarians: c.veterinarians,
      visitSplits: c.visitSplits,
      lat: 0,
      lng: 0,
    }));
  const expanded = expandSplitClinics(eligibleClinics);

  const feasibility = evaluateFeasibility({
    requiredVisits,
    requiredStops: expanded.pool.length + expanded.deferred.length,
    availableDays,
    minPerDay: settings.minVisitsPerDay,
    maxPerDay: settings.maxVisitsPerDay,
    clinics: [...expanded.pool, ...expanded.deferred],
  });

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
          availableVisits={activeClinics.reduce((sum, c) => sum + c.veterinarians, 0)}
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
