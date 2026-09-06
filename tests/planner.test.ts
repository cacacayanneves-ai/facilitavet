import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_PREFERENCES,
  generatePlan,
  recalculateRoute,
  suggestAlternatives,
  haversineMeters,
} from '@/lib/route-planner';
import type { AvailableDay, PlannerClinic, PlannerInput } from '@/lib/route-planner';
import { DEMO_HOME, generateDemoClinics } from '@/lib/demo/sao-paulo';

function buildClinics(): PlannerClinic[] {
  return generateDemoClinics({ cat1: 80, cat2: 25, cat3: 25, seed: 20260901 }).map((c, i) => ({
    id: `clinic-${i}`,
    name: c.name,
    category: c.category,
    neighborhood: c.neighborhood,
    city: c.city,
    lat: c.latitude,
    lng: c.longitude,
    lastVisitedAt: null,
  }));
}

/** Dias uteis de setembro/2026 (seg-sex), 17 dias por construcao. */
function buildDays(count = 17): AvailableDay[] {
  const days: AvailableDay[] = [];
  const cursor = new Date(Date.UTC(2026, 8, 1));
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      days.push({ date: cursor.toISOString().slice(0, 10), weekday });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    clinics: buildClinics(),
    availableDays: buildDays(17),
    monthlyTarget: 100,
    month: 9,
    year: 2026,
    origin: { label: DEMO_HOME.label, lat: DEMO_HOME.lat, lng: DEMO_HOME.lng },
    destination: null,
    categoryRules: { ...DEFAULT_CATEGORY_RULES, rules: {
      CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
      CAT2: { frequency: 'alternating', targetCount: 20, enabled: true },
      CAT3: { frequency: 'alternating', targetCount: 20, enabled: true },
    } },
    preferences: { ...DEFAULT_PREFERENCES, candidateSolutions: 4 },
    ...overrides,
  };
}

describe('motor de planejamento — plano mensal completo', () => {
  it('planeja 100 visitas em 17 dias sem perder nem duplicar clinica', async () => {
    const input = baseInput();
    const result = await generatePlan(input);

    const stops = result.routes.flatMap((r) => r.stops);
    expect(stops).toHaveLength(100);

    const ids = stops.map((s) => s.clinicId);
    expect(new Set(ids).size).toBe(100);
    expect(result.feasibility.feasible).toBe(true);
  });

  it('respeita as categorias do mes: setembro/2026 = Cat 1 + Cat 2', async () => {
    const result = await generatePlan(baseInput());
    const categories = new Set(result.routes.flatMap((r) => r.stops.map((s) => s.category)));
    expect(result.statistics.requiredCategories).toEqual(['CAT1', 'CAT2']);
    expect(categories.has('CAT3')).toBe(false);
    expect(result.statistics.perCategory.CAT1).toBe(80);
    expect(result.statistics.perCategory.CAT2).toBe(20);
  });

  it('distribui as visitas de forma equilibrada (nao 6 fixo ate acabar)', async () => {
    const result = await generatePlan(baseInput());
    const counts = result.routes.map((r) => r.stops.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('usa todos os 17 dias disponiveis', async () => {
    const result = await generatePlan(baseInput());
    expect(result.routes).toHaveLength(17);
    expect(result.routes.every((r) => r.stops.length > 0)).toBe(true);
  });

  it('produz dias geograficamente concentrados (raio medio < 6 km)', async () => {
    const result = await generatePlan(baseInput());
    for (const route of result.routes) {
      expect(route.scoreBreakdown.concentrationMeters).toBeLessThan(6000);
    }
  });

  it('bate a linha de base da carteira em ordem alfabetica com folga', async () => {
    const result = await generatePlan(baseInput());
    const baseline = result.statistics.baseline!;
    expect(baseline.totalDistanceMeters).toBeGreaterThan(result.statistics.totalDistanceMeters);
    // O ganho tem que ser expressivo, nao marginal.
    expect(baseline.distanceSavingPercent).toBeGreaterThan(50);
  });

  it('e deterministico: mesma entrada e mesma semente => mesmo plano', async () => {
    const a = await generatePlan(baseInput());
    const b = await generatePlan(baseInput());
    expect(a.routes.map((r) => r.stops.map((s) => s.clinicId))).toEqual(
      b.routes.map((r) => r.stops.map((s) => s.clinicId)),
    );
  });

  it('sequencia cada dia de forma coerente: sem grandes saltos internos', async () => {
    const result = await generatePlan(baseInput());
    for (const route of result.routes) {
      for (const stop of route.stops.slice(1)) {
        // Nenhum trecho interno deve ultrapassar 25 km numa carteira urbana.
        expect(stop.distanceFromPreviousMeters).toBeLessThan(25_000);
      }
    }
  });

  it('gera horarios crescentes dentro do dia e respeita o inicio de jornada', async () => {
    const result = await generatePlan(baseInput());
    for (const route of result.routes) {
      const times = route.stops.map((s) => s.estimatedArrival);
      const sorted = [...times].sort();
      expect(times).toEqual(sorted);
      expect(times[0] >= '08:00').toBe(true);
    }
  });

  it('pula o intervalo de almoco', async () => {
    const result = await generatePlan(baseInput());
    const inLunch = result.routes
      .flatMap((r) => r.stops)
      .filter((s) => s.estimatedArrival > '12:00' && s.estimatedArrival < '13:30');
    expect(inLunch).toHaveLength(0);
  });

  it('marca as metricas como estimadas quando nao ha provider de mapas real', async () => {
    const result = await generatePlan(baseInput());
    expect(result.statistics.estimated).toBe(true);
    expect(result.warnings.some((w) => w.code === 'MATRIX_FALLBACK')).toBe(true);
  });
});

describe('motor de planejamento — casos de contorno', () => {
  it('explica a impossibilidade de 80 visitas em 17 dias com maximo de 4/dia', async () => {
    const input = baseInput({
      monthlyTarget: 80,
      preferences: { ...DEFAULT_PREFERENCES, maxVisitsPerDay: 4, minVisitsPerDay: 2 },
    });
    const result = await generatePlan(input);
    expect(result.feasibility.feasible).toBe(false);
    expect(result.routes).toHaveLength(0);
    expect(result.feasibility.deficit).toBeGreaterThan(0);
    expect(result.feasibility.message).toContain('Nao e possivel');
  });

  it('ignora clinicas sem coordenadas mas avisa em vez de silenciar', async () => {
    const clinics = buildClinics();
    clinics[0].lat = Number.NaN;
    clinics[0].lng = Number.NaN;
    const result = await generatePlan(baseInput({ clinics }));
    expect(result.skippedClinicIds).toContain(clinics[0].id);
    expect(result.warnings.some((w) => w.code === 'MISSING_COORDINATES')).toBe(true);
    expect(result.routes.flatMap((r) => r.stops).map((s) => s.clinicId)).not.toContain(clinics[0].id);
  });

  it('avisa quando a meta e maior que a carteira disponivel', async () => {
    const result = await generatePlan(baseInput({ monthlyTarget: 500 }));
    expect(result.warnings.some((w) => w.code === 'TARGET_ABOVE_POOL')).toBe(true);
  });

  it('continua funcionando quando o provider de matriz falha (fallback)', async () => {
    const input = baseInput({
      resolveMatrix: async () => {
        throw new Error('Google Routes indisponivel');
      },
    });
    const result = await generatePlan(input);
    expect(result.routes.flatMap((r) => r.stops)).toHaveLength(100);
    expect(result.statistics.matrixProvider).toBe('offline-geometric');
  });

  it('usa a matriz real quando o provider responde', async () => {
    let called = 0;
    const input = baseInput({
      resolveMatrix: async (req) => {
        called += 1;
        const n = req.origins.length;
        const distances = Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) =>
            Math.round(haversineMeters(req.origins[i], req.destinations[j]) * 1.4),
          ),
        );
        return {
          distances,
          durations: distances.map((row) => row.map((d) => Math.round((d / 1000 / 22) * 3600))),
          provider: 'fake-google',
          estimated: false,
        };
      },
    });
    const result = await generatePlan(input);
    expect(called).toBeGreaterThan(0);
    expect(result.statistics.matrixProvider).toBe('fake-google');
    expect(result.statistics.estimated).toBe(false);
    expect(result.warnings.some((w) => w.code === 'MATRIX_FALLBACK')).toBe(false);
  });

  it('respeita destino fixo terminando o dia perto dele', async () => {
    const destination = { label: 'Escritorio', lat: -23.576, lng: -46.689 };
    const result = await generatePlan(baseInput({ destination }));
    expect(result.routes.every((r) => r.destinationLabel === 'Escritorio')).toBe(true);
    expect(result.routes.flatMap((r) => r.stops)).toHaveLength(100);
  });

  it('encadeia dias quando a origem e "ultima visita" (origin nulo)', async () => {
    const result = await generatePlan(baseInput({ origin: null }));
    expect(result.routes.flatMap((r) => r.stops)).toHaveLength(100);
  });
});

describe('edicao manual da rota', () => {
  it('recalcula metricas ao reordenar mantendo a ordem escolhida', async () => {
    const result = await generatePlan(baseInput());
    const route = result.routes[0];
    const clinics = buildClinics();
    const byId = new Map(clinics.map((c) => [c.id, c]));
    const ordered = route.stops.map((s) => byId.get(s.clinicId)!);
    const swapped = [...ordered];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];

    const recalculated = await recalculateRoute({
      date: route.date,
      clinics: swapped,
      origin: route.origin,
      destination: route.destination,
      input: { preferences: DEFAULT_PREFERENCES, origin: null, destination: null },
      keepOrder: true,
    });

    expect(recalculated.stops.map((s) => s.clinicId)).toEqual(swapped.map((c) => c.id));
    // A rota otimizada nao pode ser pior que a manual reordenada.
    expect(recalculated.totalDistanceMeters).toBeGreaterThanOrEqual(route.totalDistanceMeters - 1);
    expect(recalculated.scoreBreakdown.totalDurationSeconds).toBeGreaterThan(0);
  });

  it('reotimiza quando keepOrder e falso', async () => {
    const clinics = buildClinics().slice(0, 6);
    const recalculated = await recalculateRoute({
      date: '2026-09-14',
      clinics,
      origin: { lat: DEMO_HOME.lat, lng: DEMO_HOME.lng },
      destination: null,
      input: { preferences: DEFAULT_PREFERENCES, origin: null, destination: null },
      keepOrder: false,
    });
    expect(recalculated.stops).toHaveLength(6);
    expect(new Set(recalculated.stops.map((s) => s.sequence))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('sugere alternativas ordenadas pelo custo adicional de insercao', async () => {
    const result = await generatePlan(baseInput());
    const route = result.routes[0];
    const usedIds = new Set(result.routes.flatMap((r) => r.stops.map((s) => s.clinicId)));
    const pool = buildClinics().filter((c) => !usedIds.has(c.id));

    const alternatives = suggestAlternatives({
      route: { stops: route.stops, origin: route.origin, destination: route.destination },
      replaceSequence: 2,
      pool: pool.length ? pool : buildClinics(),
      limit: 3,
    });

    expect(alternatives.length).toBeGreaterThan(0);
    const deltas = alternatives.map((a) => a.extraSeconds);
    expect(deltas).toEqual([...deltas].sort((a, b) => a - b));
  });
});
