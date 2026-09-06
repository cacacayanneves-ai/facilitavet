'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Sparkles, Wand2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
} from '@/components/ui';
import type { CalendarDay } from '@/lib/services/calendar';
import type { FeasibilityReport } from '@/lib/route-planner';
import { cn, formatDuration, formatKm, formatNumber, monthName } from '@/lib/utils';
import { GenerationProgress } from './generation-progress';

interface Props {
  year: number;
  month: number;
  monthlyTarget: number;
  minPerDay: number;
  maxPerDay: number;
  calendar: CalendarDay[];
  availableDays: number;
  forecast: Array<{ year: number; month: number; categories: string[] }>;
  clinicsByCategory: Record<string, number>;
  categoryTargets: Record<string, number>;
  availableVisits: number;
  feasibility: FeasibilityReport;
  existingPlan: {
    id: string;
    generatedAt: string | null;
    targetVisits: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    averageScore: number;
    statistics: Record<string, unknown> | null;
  } | null;
}

export function PlanningWorkspace(props: Props) {
  const router = useRouter();
  const [target, setTarget] = React.useState(props.existingPlan?.targetVisits ?? props.monthlyTarget);
  const [generating, setGenerating] = React.useState(false);
  const [result, setResult] = React.useState<GenerationResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [calendar, setCalendar] = React.useState(props.calendar);

  const availableDays = calendar.filter((d) => d.available).length;
  const capacity = availableDays * props.maxPerDay;
  const perDay = availableDays > 0 ? target / availableDays : 0;
  const feasible = availableDays > 0 && target <= capacity;

  async function generate() {
    setGenerating(true);
    setError(null);
    setResult(null);

    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: props.year, month: props.month, targetVisits: target }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível gerar o roteiro.');
      setGenerating(false);
      return;
    }

    setResult(data);
    setGenerating(false);
    router.refresh();
  }

  async function toggleDay(day: CalendarDay) {
    // Fim de semana e feriado nao sao "desbloqueaveis" por aqui: mudar isso e
    // decisao de configuracao (dias de trabalho), nao de um clique no calendario.
    if (day.reason === 'WEEKEND' || day.reason === 'HOLIDAY' || day.reason === 'OFF_DAY') return;

    const blocked = day.reason === 'BLOCKED';
    setCalendar((prev) =>
      prev.map((d) =>
        d.date === day.date
          ? { ...d, available: blocked, reason: blocked ? null : 'BLOCKED' }
          : d,
      ),
    );

    await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: day.date, blocked: !blocked, reason: 'Bloqueado manualmente' }),
    });
    router.refresh();
  }

  function changeMonth(delta: number) {
    const abs = props.year * 12 + (props.month - 1) + delta;
    router.push(`/planejamento?year=${Math.floor(abs / 12)}&month=${(abs % 12) + 1}`);
  }

  const totalClinics = Object.values(props.clinicsByCategory).reduce((a, b) => a + b, 0);
  const requiredCategories = props.forecast[0]?.categories ?? [];

  return (
    <div className="space-y-6">
      {/* Seletor de mes */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} title="Mês anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-44 text-center text-lg font-semibold capitalize tracking-tight text-ink-900">
            {monthName(props.month)} {props.year}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} title="Próximo mês">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {requiredCategories.map((category) => (
            <Badge key={category} tone={category === 'CAT1' ? 'cat1' : category === 'CAT2' ? 'cat2' : 'cat3'}>
              {category.replace('CAT', 'Cat ')}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Coluna principal */}
        <div className="space-y-6">
          {/* Regras do mes */}
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Regras deste mês</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  O ciclo comercial decide quais categorias entram. Cat 1 é mensal; Cat 2 e Cat 3
                  alternam mês sim, mês não.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {(['CAT1', 'CAT2', 'CAT3'] as const).map((category) => {
                  const required = requiredCategories.includes(category);
                  const inCarteira = props.clinicsByCategory[category] ?? 0;
                  const configured = props.categoryTargets[category] ?? 0;
                  return (
                    <div
                      key={category}
                      className={cn(
                        'rounded-xl border px-3.5 py-3 transition-colors',
                        required ? 'border-brand-200 bg-brand-50/60' : 'border-ink-200 bg-ink-50',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink-800">
                          {category.replace('CAT', 'Cat ')}
                        </span>
                        {required ? (
                          <Badge tone="brand">no mês</Badge>
                        ) : (
                          <span className="text-[10px] text-ink-400">fora do ciclo</span>
                        )}
                      </div>
                      <p className="tabular mt-1.5 text-xl font-semibold text-ink-900">
                        {required ? Math.min(configured, inCarteira) : 0}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        meta {configured} · {inCarteira} na carteira
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Previsao do ciclo — deixa a regra visivel em vez de magica */}
              <div className="flex flex-wrap gap-1.5 border-t border-ink-200 pt-3">
                <span className="mr-1 text-[11px] font-medium text-ink-400">Próximos meses:</span>
                {props.forecast.slice(1).map((item) => (
                  <span
                    key={`${item.year}-${item.month}`}
                    className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500"
                  >
                    {monthName(item.month).slice(0, 3)}{' '}
                    {item.categories.map((c) => c.replace('CAT', '')).join('+')}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Calendario de dias uteis */}
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Dias disponíveis</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Clique num dia útil para bloqueá-lo (viagem, treinamento, folga).
                  </p>
                </div>
                <p className="tabular text-2xl font-semibold text-ink-900">{availableDays}</p>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((label) => (
                  <div key={label} className="pb-1 text-center text-[10px] font-medium uppercase text-ink-400">
                    {label}
                  </div>
                ))}
                {calendar.length > 0 &&
                  Array.from({ length: new Date(`${calendar[0].date}T00:00:00Z`).getUTCDay() }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                {calendar.map((day) => {
                  const number = Number(day.date.slice(8, 10));
                  const clickable = day.reason === null || day.reason === 'BLOCKED';
                  return (
                    <button
                      key={day.date}
                      onClick={() => toggleDay(day)}
                      disabled={!clickable}
                      title={
                        day.holidayName
                          ? `Feriado: ${day.holidayName}`
                          : day.reason === 'BLOCKED'
                            ? `Bloqueado: ${day.blockedReason ?? 'manual'}`
                            : day.available
                              ? 'Dia útil, clique para bloquear'
                              : 'Fora dos dias de trabalho'
                      }
                      className={cn(
                        'tabular relative aspect-square rounded-lg text-xs font-medium transition-all duration-150',
                        day.available && 'bg-brand-50 text-brand-800 hover:bg-brand-100 hover:ring-1 hover:ring-brand-300',
                        day.reason === 'BLOCKED' && 'bg-[var(--color-danger-soft)] text-[var(--color-danger-text)] hover:brightness-95',
                        day.reason === 'HOLIDAY' && 'bg-[var(--color-warning-soft)] text-[var(--color-warning-text)] cursor-not-allowed',
                        (day.reason === 'WEEKEND' || day.reason === 'OFF_DAY') && 'bg-ink-100 text-ink-300 cursor-not-allowed',
                      )}
                    >
                      {number}
                      {day.reason === 'HOLIDAY' && (
                        <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-[var(--color-warning)]" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3 border-t border-ink-200 pt-3 text-[10px] text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded bg-brand-100" /> Disponível
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded bg-[var(--color-warning-soft)]" /> Feriado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded bg-[var(--color-danger-soft)]" /> Bloqueado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded bg-ink-100" /> Fora da jornada
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coluna de acao */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardContent className="space-y-4">
              <Field
                label="Visitas no mês"
                hint={
                  availableDays > 0
                    ? `≈ ${perDay.toFixed(1).replace('.', ',')} visitas por dia`
                    : 'Nenhum dia disponível'
                }
              >
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={target}
                  onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 0))}
                  className="tabular text-lg font-semibold"
                />
              </Field>

              <dl className="space-y-1.5 rounded-lg bg-ink-50 px-3 py-2.5 text-[11px]">
                <Row label="Carteira ativa" value={`${totalClinics} clínicas`} />
                <Row label="Visitas disponíveis" value={`${props.availableVisits}`} />
                <Row label="Dias disponíveis" value={`${availableDays}`} />
                <Row label="Capacidade máxima" value={`${capacity} visitas`} />
              </dl>

              {!feasible && (
                <Alert tone="danger" title="Meta acima da capacidade">
                  {availableDays === 0
                    ? 'Não há nenhum dia disponível neste mês. Ajuste os dias de trabalho ou os bloqueios.'
                    : `Com ${availableDays} dia(s) e no máximo ${props.maxPerDay} visitas por dia, cabem ${capacity} visitas. Faltam ${target - capacity}. Você precisa de pelo menos ${Math.ceil(target / props.maxPerDay)} dias, ou aumentar o limite diário nas configurações.`}
                </Alert>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={generate}
                loading={generating}
                disabled={!feasible}
              >
                {!generating && <Wand2 className="size-4" />}
                {props.existingPlan ? 'Refazer roteiro' : 'Criar meu roteiro'}
              </Button>

              {props.existingPlan && !result && (
                <p className="text-center text-[11px] text-ink-400">
                  Gerado em{' '}
                  {props.existingPlan.generatedAt
                    ? new Date(props.existingPlan.generatedAt).toLocaleString('pt-BR')
                    : '—'}
                </p>
              )}
            </CardContent>
          </Card>

          {generating && <GenerationProgress />}

          {error && (
            <Alert tone="danger" title="Falha ao gerar">
              {error}
            </Alert>
          )}

          {result && <ResultCard result={result} />}

          {props.existingPlan && !result && !generating && (
            <Card>
              <CardContent className="space-y-2.5">
                <p className="text-xs font-semibold text-ink-800">Plano atual</p>
                <dl className="space-y-1.5 text-[11px]">
                  <Row label="Visitas" value={`${props.existingPlan.targetVisits}`} />
                  <Row label="Distância" value={formatKm(props.existingPlan.totalDistanceMeters)} />
                  <Row label="Deslocamento" value={formatDuration(props.existingPlan.totalDurationSeconds)} />
                  <Row label="Score médio" value={`${formatNumber(props.existingPlan.averageScore)}/100`} />
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular font-medium text-ink-800">{value}</dd>
    </div>
  );
}

interface GenerationResult {
  planId: string | null;
  feasibility: FeasibilityReport;
  statistics: {
    selectedVisits: number;
    plannedDays: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    averageScore: number;
    estimated: boolean;
    baseline: { distanceSavingPercent: number; durationSavingSeconds: number } | null;
  };
  warnings: Array<{ code: string; message: string }>;
  analysis: string | null;
}

function ResultCard({ result }: { result: GenerationResult }) {
  if (!result.planId) {
    return (
      <Alert tone="danger" title="Não foi possível planejar">
        {result.feasibility.message}
      </Alert>
    );
  }

  const s = result.statistics;

  return (
    <Card className="animate-[rise_0.35s_cubic-bezier(0.16,1,0.3,1)] border-brand-200">
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand-600 text-[var(--color-on-brand)]">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-sm font-semibold text-ink-900">Seu mês está pronto 🚀</p>
        </div>

        <dl className="space-y-1.5 text-[11px]">
          <Row label="Visitas" value={`${s.selectedVisits}`} />
          <Row label="Dias" value={`${s.plannedDays}`} />
          <Row label={s.estimated ? 'Distância estimada' : 'Distância'} value={formatKm(s.totalDistanceMeters)} />
          <Row label="Deslocamento" value={formatDuration(s.totalDurationSeconds)} />
          <Row label="Score médio" value={`${formatNumber(s.averageScore)}/100`} />
        </dl>

        {/* Economia so aparece com comparacao calculada — nunca inventada. */}
        {s.baseline && s.baseline.distanceSavingPercent > 0 && (
          <Alert tone="positive" className="!text-[11px]">
            <strong>{s.baseline.distanceSavingPercent}% menos deslocamento</strong> que percorrer a
            carteira na ordem da planilha.
          </Alert>
        )}

        {result.analysis && (
          <div className="rounded-lg bg-ink-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              Leitura do Claude
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{result.analysis}</p>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="space-y-1.5">
            {result.warnings.map((warning, i) => (
              <p key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-500">
                <AlertTriangle className="mt-px size-3 shrink-0 text-[var(--color-warning)]" />
                {warning.message}
              </p>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full" onClick={() => (window.location.href = '/agenda')}>
          Ver a agenda do mês
        </Button>
      </CardContent>
    </Card>
  );
}
