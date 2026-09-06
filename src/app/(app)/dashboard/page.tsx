import Link from 'next/link';
import { ArrowRight, CalendarDays, Gauge, MapPin, Route as RouteIcon, TrendingDown, Upload } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getDashboardData } from '@/lib/services/dashboard';
import { Topbar } from '@/components/layout/topbar';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Progress } from '@/components/ui';
import { TodayPanel } from './today-panel';
import {
  CATEGORY_LABEL,
  cn,
  formatDateLong,
  formatDuration,
  formatKm,
  formatNumber,
  greeting,
  monthName,
} from '@/lib/utils';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user);
  const firstName = user.name.split(' ')[0];

  const planned = data.progress.planned;
  const target = data.progress.target || user.settings!.monthlyTarget;
  const planPercent = target > 0 ? Math.min(100, Math.round((planned / target) * 100)) : 0;
  const totalClinics = Object.values(data.clinicsByCategory).reduce((a, b) => a + b, 0);

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={`${monthName(data.month)} de ${data.year}`}
        estimated={data.estimated && Boolean(data.plan)}
        actions={
          <Link
            href="/planejamento"
            className="hidden h-8 items-center rounded-lg border border-ink-300 bg-white px-3 text-xs font-medium text-ink-700 transition-colors hover:border-ink-400 hover:bg-ink-50 sm:inline-flex"
          >
            Planejar mês
          </Link>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Saudacao — responde "como esta meu mes?" numa linha */}
        <section className="animate-[rise_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          <h2 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
            {greeting()}, {firstName} 👋
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {data.plan
              ? <>Seu mês está <span className="font-medium text-ink-800">{planPercent}% planejado</span> — {planned} de {target} visitas distribuídas em {data.progress.plannedDays} dias.</>
              : totalClinics === 0
                ? <>Comece importando sua carteira de clínicas — o roteiro vem em seguida.</>
                : <>Sua carteira está pronta. Gere o roteiro de {monthName(data.month)} para começar.</>}
          </p>
        </section>

        {/* Carteira vazia (conta recem-criada) tem outro proximo passo: sem
            clinicas nao ha o que roteirizar, entao o convite e importar. */}
        {!data.plan && totalClinics === 0 && (
          <Card>
            <EmptyState
              icon={<Upload className="size-5" strokeWidth={1.75} />}
              title="Sua carteira ainda está vazia"
              description="Importe a planilha com suas clínicas — nome, endereço, categoria e quantos veterinários cada uma tem. Você revisa tudo antes de confirmar."
              action={
                <Link href="/carteira/importar">
                  <Button size="lg">
                    Importar minha carteira
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
              }
            />
          </Card>
        )}

        {!data.plan && totalClinics > 0 && (
          <Card>
            <EmptyState
              icon={<RouteIcon className="size-5" strokeWidth={1.75} />}
              title={`${monthName(data.month)} ainda não foi planejado`}
              description={`Você tem ${totalClinics} clínicas na carteira e ${data.availableDays} dias úteis neste mês. O Facilita Vet monta a agenda inteira em segundos.`}
              action={
                <Link href="/planejamento">
                  <Button size="lg">
                    Criar meu roteiro
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
              }
            />
          </Card>
        )}

        {/* HOJE — a resposta para "o que eu preciso fazer hoje?" */}
        <TodayPanel
          route={serializeRoute(data.todayRoute)}
          nextRoute={serializeRoute(data.nextRoute)}
          today={data.today}
        />

        {/* Metricas do mes */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Visitas do mês"
            value={String(target)}
            hint={`${planned} planejadas · ${Math.max(0, target - data.progress.completed)} restantes`}
            icon={<RouteIcon className="size-4" strokeWidth={1.75} />}
            footer={<Progress value={planPercent} />}
          />
          <MetricCard
            label="Dias disponíveis"
            value={String(data.availableDays)}
            hint={`${data.progress.plannedDays} dias planejados`}
            icon={<CalendarDays className="size-4" strokeWidth={1.75} />}
          />
          <MetricCard
            label="Média diária"
            value={data.progress.averagePerDay ? formatNumber(data.progress.averagePerDay) : '—'}
            hint="visitas por dia planejado"
            icon={<Gauge className="size-4" strokeWidth={1.75} />}
          />
          <MetricCard
            label="Deslocamento"
            value={data.progress.totalDistanceMeters ? formatKm(data.progress.totalDistanceMeters) : '—'}
            hint={
              data.progress.totalDurationSeconds
                ? `${formatDuration(data.progress.totalDurationSeconds)} estimadas`
                : 'sem plano gerado'
            }
            icon={<MapPin className="size-4" strokeWidth={1.75} />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Progresso e categorias */}
          <Card className="lg:col-span-2">
            <CardContent className="space-y-5">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Progresso do mês</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {data.progress.completed} concluídas · {data.progress.cancelled} canceladas
                  </p>
                </div>
                <p className="tabular text-2xl font-semibold text-ink-900">
                  {target > 0 ? Math.round((data.progress.completed / target) * 100) : 0}%
                </p>
              </div>

              <Progress
                value={target > 0 ? (data.progress.completed / target) * 100 : 0}
                tone="positive"
              />

              <div className="grid grid-cols-3 gap-3 border-t border-ink-200 pt-4">
                {(['CAT1', 'CAT2', 'CAT3'] as const).map((category) => {
                  const required = data.requiredCategories.includes(category);
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: `var(--color-${category.toLowerCase()})` }}
                        />
                        <span className="text-xs font-medium text-ink-600">
                          {CATEGORY_LABEL[category]}
                        </span>
                        {required && <Badge tone="brand">no mês</Badge>}
                      </div>
                      <p className="tabular mt-1 text-lg font-semibold text-ink-900">
                        {data.progress.perCategory[category]}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {data.clinicsByCategory[category] ?? 0} na carteira
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Economia — SO aparece com comparacao calculada (secao 34) */}
              {data.statistics?.baseline && data.statistics.baseline.distanceSavingPercent > 0 && (
                <Alert tone="positive" className="!text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <TrendingDown className="size-3.5 shrink-0" />
                    <span>
                      A rota otimizada reduz{' '}
                      <strong>{data.statistics.baseline.distanceSavingPercent}%</strong> do deslocamento
                      em relação a percorrer a carteira na ordem da planilha
                      {data.statistics.baseline.durationSavingSeconds > 0 && (
                        <> — cerca de {formatDuration(data.statistics.baseline.durationSavingSeconds)} a menos no mês</>
                      )}
                      .
                    </span>
                  </span>
                </Alert>
              )}

              {data.statistics?.analysis && (
                <div className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    Leitura do Claude
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{data.statistics.analysis}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Proximos dias */}
          <Card>
            <CardContent className="space-y-1">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-900">Próximos dias</p>
                <Link href="/agenda" className="text-xs font-medium text-brand-700 hover:text-brand-900">
                  Ver agenda
                </Link>
              </div>

              {data.upcomingRoutes.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-400">Nenhum dia planejado à frente.</p>
              ) : (
                data.upcomingRoutes.map((route) => {
                  const key = route.date.toISOString().slice(0, 10);
                  return (
                    <Link
                      key={route.id}
                      href={`/agenda/${key}`}
                      className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-ink-100"
                    >
                      <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-ink-100 group-hover:bg-white">
                        <span className="tabular text-sm font-semibold leading-none text-ink-800">
                          {route.date.getUTCDate()}
                        </span>
                        <span className="text-[9px] font-medium uppercase text-ink-400">
                          {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][route.date.getUTCDay()]}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink-800">
                          {route._count.stops} visitas
                        </p>
                        <p className="truncate text-[11px] text-ink-400">
                          {route.regionLabel || formatDateLong(route.date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-[11px] font-medium text-ink-600">
                          {formatKm(route.totalDistanceMeters)}
                        </p>
                        <p className="tabular text-[10px] text-ink-400">
                          {formatDuration(route.totalDurationSeconds)}
                        </p>
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  footer,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="transition-shadow duration-200 hover:shadow-[var(--shadow-float)]">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-ink-500">{label}</p>
          {icon && <span className="text-ink-300">{icon}</span>}
        </div>
        <p className={cn('tabular text-3xl font-semibold leading-none tracking-tight text-ink-900')}>
          {value}
        </p>
        {hint && <p className="text-[11px] text-ink-400">{hint}</p>}
        {footer}
      </CardContent>
    </Card>
  );
}

type RouteWithStops = NonNullable<Awaited<ReturnType<typeof getDashboardData>>['todayRoute']>;

/** Converte o registro do Prisma no formato serializavel do componente cliente. */
function serializeRoute(route: RouteWithStops | null) {
  if (!route) return null;
  return {
    id: route.id,
    date: route.date.toISOString().slice(0, 10),
    regionLabel: route.regionLabel,
    totalDistanceMeters: route.totalDistanceMeters,
    totalDurationSeconds: route.totalDurationSeconds,
    origin:
      route.originLatitude !== null && route.originLongitude !== null
        ? { lat: route.originLatitude, lng: route.originLongitude, label: route.originLabel ?? 'Origem' }
        : null,
    stops: route.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      clinicId: stop.clinicId,
      clinicName: stop.clinic.name,
      neighborhood: stop.clinic.neighborhood,
      address: stop.clinic.address,
      category: stop.clinic.category,
      lat: stop.clinic.latitude,
      lng: stop.clinic.longitude,
      estimatedArrival: stop.estimatedArrival?.toISOString() ?? null,
      distanceFromPreviousMeters: stop.distanceFromPreviousMeters,
      durationFromPreviousSeconds: stop.durationFromPreviousSeconds,
      visitId: stop.visit?.id ?? null,
      status: stop.visit?.status ?? 'PLANNED',
      veterinarians: stop.veterinarians,
      part: stop.part,
      totalParts: stop.totalParts,
    })),
  };
}
