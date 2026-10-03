import { describe, expect, it } from 'vitest';
import { generatePlan, DEFAULT_CATEGORY_RULES, DEFAULT_PREFERENCES, type AvailableDay, type PlannerClinic } from '@/lib/route-planner';

/**
 * Regras de dia vindas da planilha: o motor agrupa por geografia e depois
 * repara quem caiu num dia proibido. Estes testes travam as regras
 * obrigatorias (dia da semana, data marcada, "uma das visitas na quinta") e o
 * limite diario.
 */
function octoberWorkdays(): AvailableDay[] {
  const days: AvailableDay[] = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = new Date(Date.UTC(2026, 9, d));
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5 && d !== 12) days.push({ date: date.toISOString().slice(0, 10), weekday });
  }
  return days;
}

function clinic(id: string, overrides: Partial<PlannerClinic> = {}): PlannerClinic {
  const n = Number.parseInt(id.replace(/\D/g, ''), 10) || 0;
  return {
    id,
    name: id,
    category: 'CAT1',
    veterinarians: 2,
    lat: -22.9 + (n % 7) * 0.012,
    lng: -43.55 + Math.floor(n / 7) * 0.015,
    monthlyVisits: 1,
    ...overrides,
  };
}

async function plan(clinics: PlannerClinic[]) {
  return generatePlan({
    clinics,
    availableDays: octoberWorkdays(),
    monthlyTarget: 9999,
    month: 10,
    year: 2026,
    origin: null,
    destination: null,
    categoryRules: { ...DEFAULT_CATEGORY_RULES, mode: 'frequency' },
    preferences: { ...DEFAULT_PREFERENCES, seed: 3 },
  });
}

function daysOf(result: Awaited<ReturnType<typeof plan>>, clinicId: string): string[] {
  return result.routes.filter((r) => r.stops.some((s) => s.clinicId === clinicId)).map((r) => r.date);
}
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

describe('regras de dia no planejamento', () => {
  const base = Array.from({ length: 60 }, (_, i) => clinic(`c${i}`));

  it('respeita "sempre sexta", "terça ou quinta" e data marcada', async () => {
    const result = await plan([
      ...base,
      clinic('sexta1', { allowedWeekdays: [5] }),
      clinic('sexta2', { allowedWeekdays: [5], lat: -22.98, lng: -43.7 }),
      clinic('terqui', { allowedWeekdays: [2, 4], veterinarians: 12 }),
      clinic('marcada', { fixedDate: '2026-10-16' }),
    ]);

    for (const id of ['sexta1', 'sexta2']) {
      const days = daysOf(result, id);
      expect(days).toHaveLength(1);
      expect(weekdayOf(days[0])).toBe(5);
    }
    expect([2, 4]).toContain(weekdayOf(daysOf(result, 'terqui')[0]));
    expect(daysOf(result, 'marcada')).toEqual(['2026-10-16']);
  });

  it('clinica 2x com "um dia na quinta": duas visitas em dias diferentes, uma numa quinta', async () => {
    const result = await plan([
      ...base,
      clinic('ceisafa', { veterinarians: 4, visitSplits: 2, monthlyVisits: 2, oneVisitWeekday: 4 }),
    ]);
    const days = daysOf(result, 'ceisafa');
    expect(days).toHaveLength(2);
    expect(new Set(days).size).toBe(2);
    expect(days.some((d) => weekdayOf(d) === 4)).toBe(true);
  });

  it('modo frequencia: so entra quem tem visita no mes, sem cota de categoria', async () => {
    const result = await plan([
      ...base,
      clinic('fora', { monthlyVisits: 0 }),
      clinic('vari2', { category: 'CAT3' }),
    ]);
    expect(daysOf(result, 'fora')).toHaveLength(0);
    expect(daysOf(result, 'vari2')).toHaveLength(1);
    expect(result.statistics.selectedStops).toBe(base.length + 1);
  });

  it('mover clinicas por regra nao estoura o limite diario', async () => {
    const constrained = Array.from({ length: 6 }, (_, i) => clinic(`sx${i}`, { allowedWeekdays: [5], veterinarians: 3 }));
    const result = await plan([...base, ...constrained]);
    for (const route of result.routes) expect(route.totalVisits).toBeLessThanOrEqual(DEFAULT_PREFERENCES.maxVisitsPerDay);
  });
});
