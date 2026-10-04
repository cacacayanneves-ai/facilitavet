import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildWorkCalendar } from '@/lib/services/calendar';
import { parseCategoryRules } from '@/lib/services/settings';
import { categoryForecast, evaluateFeasibility, expandSplitClinics, selectClinicsForMonth } from '@/lib/route-planner';
import { Topbar } from '@/components/layout/topbar';
import { PlanningWorkspace } from './planning-workspace';
import { currentYearMonth } from '@/lib/utils';

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

  const now = currentYearMonth();
  const year = Number.parseInt(params.year ?? '', 10) || now.year;
  const month = Number.parseInt(params.month ?? '', 10) || now.month;

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
      select: {
        id: true,
        name: true,
        category: true,
        veterinarians: true,
        visitSplits: true,
        monthlyVisits: true,
        allowedWeekdays: true,
        oneVisitWeekday: true,
        fixedVisitDate: true,
      },
    }),
  ]);

  const availableDays = calendar.filter((d) => d.available).length;
  const forecast = categoryForecast(rules, year, month, 6);

  // Clinicas por categoria (exibicao): contagem simples da carteira ativa.
  const byCategory = Object.fromEntries(clinicStats.map((c) => [c.category, c._count])) as Record<string, number>;

  // A previa roda a MESMA selecao do motor (cotas do ciclo, datas marcadas,
  // complemento da Cat 3 com Cat 2, frequencia vazia fora) — assim o numero
  // mostrado aqui e exatamente o que o "Criar meu roteiro" vai planejar.
  const preview = selectClinicsForMonth(
    activeClinics.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      veterinarians: c.veterinarians,
      visitSplits: c.visitSplits,
      monthlyVisits: c.monthlyVisits,
      fixedDate: c.fixedVisitDate ? c.fixedVisitDate.toISOString().slice(0, 10) : null,
      lat: 0,
      lng: 0,
    })),
    rules,
    year,
    month,
    settings.monthlyTarget,
    new Date(),
  );
  const requiredVisits = preview.totalVisits;

  // Mesma verificacao de viabilidade do motor (incluindo clinicas cujo numero
  // de veterinarios sozinho estoura o limite diario), para que esta previa
  // nunca diga "viavel" quando o planejamento real nao conseguiria gerar o mes.
  const expanded = expandSplitClinics(preview.selected);

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
          requiredCategories={preview.requiredCategories}
          plannedByCategory={preview.perCategory}
          selectionNotes={preview.warnings
            .filter((w) => w.code === 'CATEGORY_COMPLEMENT' || w.code === 'CATEGORY_BELOW_MINIMUM')
            .map((w) => w.message)}
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
