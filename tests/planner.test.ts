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

/**
 * `withSplits: false` (padrao) mantem todas as clinicas atomicas — necessario
 * para os testes gerais, que verificam "cada clinica aparece no maximo uma
 * vez no mes inteiro". Divisao de visita e testada a parte, com clinicas
 * construidas a mao para controle total sobre separacao de dias.
 */
function buildClinics(options: { withSplits?: boolean } = {}): PlannerClinic[] {
  return generateDemoClinics({ cat1: 80, cat2: 60, cat3: 60, seed: 20260901 }).map((c, i) => ({
    id: `clinic-${i}`,
    name: c.name,
    category: c.category,
    neighborhood: c.neighborhood,
    city: c.city,
    lat: c.latitude,
    lng: c.longitude,
    veterinarians: c.veterinarians,
    visitSplits: options.withSplits ? c.visitSplits : 1,
    lastVisitedAt: null,
  }));
}

function totalVeterinarians(clinics: PlannerClinic[]): number {
  return clinics.reduce((sum, c) => sum + Math.max(1, Math.round(c.veterinarians || 1)), 0);
}

/** Dias uteis a partir de 1/9/2026 (seg-sex). */
function buildDays(count = 22): AvailableDay[] {
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

/**
 * 160 visitas (veterinarios) / mes, Cat1 mensal + categoria alternada, ambas
 * com meta de 80 visitas — o cenario real descrito pelo produto: uma carteira
 * grande onde cada clinica pode valer mais de uma visita.
 */
function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    clinics: buildClinics(),
    availableDays: buildDays(22),
    monthlyTarget: 160,
    month: 9,
    year: 2026,
    origin: { label: DEMO_HOME.label, lat: DEMO_HOME.lat, lng: DEMO_HOME.lng },
    destination: null,
    categoryRules: {
      ...DEFAULT_CATEGORY_RULES,
      rules: {
        CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
        CAT2: { frequency: 'alternating', targetCount: 80, enabled: true },
        CAT3: { frequency: 'alternating', targetCount: 80, enabled: true },
      },
    },
    preferences: { ...DEFAULT_PREFERENCES, candidateSolutions: 4 },
    ...overrides,
  };
}

describe('motor de planejamento — plano mensal completo', () => {
  it('planeja 160 visitas (veterinarios) em clinicas unicas, sem duplicar nem perder', async () => {
    const input = baseInput();
    const result = await generatePlan(input);

    const stops = result.routes.flatMap((r) => r.stops);

    // Visitas (veterinarios) somam exatamente a meta — essa e a unidade que
    // o propagandista realmente cobra.
    expect(stops.reduce((sum, s) => sum + s.veterinarians, 0)).toBe(160);
    expect(result.statistics.selectedVisits).toBe(160);

    // Nenhuma clinica e visitada duas vezes no mes (sem divisao de visita
    // nesta carteira de teste).
    const ids = stops.map((s) => s.clinicId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.feasibility.feasible).toBe(true);
  });

  it('uma clinica com N veterinarios conta como N visitas numa unica parada', async () => {
    const result = await generatePlan(baseInput());
    const stops = result.routes.flatMap((r) => r.stops);
    // A carteira de demonstracao tem clinicas de varios tamanhos — pelo menos
    // uma parada deve valer mais que 1 visita.
    expect(stops.some((s) => s.veterinarians > 1)).toBe(true);
    // O numero de PARADAS (clinicas) e necessariamente menor que o de
    // VISITAS quando ha clinicas com mais de um veterinario.
    expect(result.statistics.selectedStops).toBeLessThan(result.statistics.selectedVisits);
  });

  it('respeita as categorias do mes: setembro/2026 = Cat 1 + Cat 2', async () => {
    const result = await generatePlan(baseInput());
    const categories = new Set(result.routes.flatMap((r) => r.stops.map((s) => s.category)));
    expect(result.statistics.requiredCategories).toEqual(['CAT1', 'CAT2']);
    expect(categories.has('CAT3')).toBe(false);
    expect(result.statistics.perCategory.CAT1).toBe(80);
    expect(result.statistics.perCategory.CAT2).toBe(80);
  });

  it('distribui as VISITAS de forma equilibrada (nao trava num numero fixo)', async () => {
    const result = await generatePlan(baseInput());
    const visitsPerDay = result.routes.map((r) => r.totalVisits);
    expect(visitsPerDay.reduce((a, b) => a + b, 0)).toBe(160);
    // Nenhum dia deve se afastar muito da meta diaria ideal.
    const ideal = 160 / result.routes.length;
    for (const day of visitsPerDay) {
      expect(Math.abs(day - ideal)).toBeLessThanOrEqual(DEFAULT_PREFERENCES.maxVisitsPerDay);
    }
  });

  it('usa varios dos dias disponiveis e todos os dias planejados tem visitas', async () => {
    const result = await generatePlan(baseInput());
    expect(result.routes.length).toBeGreaterThan(1);
    expect(result.routes.every((r) => r.totalVisits > 0)).toBe(true);
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
    expect(baseline.distanceSavingPercent).toBeGreaterThan(30);
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

  it('uma clinica com mais veterinarios ocupa mais tempo de atendimento', async () => {
    const result = await generatePlan(baseInput());
    for (const route of result.routes) {
      for (let i = 1; i < route.stops.length; i += 1) {
        const prev = route.stops[i - 1];
        const curr = route.stops[i];
        // Minutos entre chegadas = deslocamento + atendimento + folga. Uma
        // clinica com mais veterinarios deve consumir mais desses minutos.
        const [ph, pm] = prev.estimatedArrival.split(':').map(Number);
        const [ch, cm] = curr.estimatedArrival.split(':').map(Number);
        const gapMinutes = ch * 60 + cm - (ph * 60 + pm);
        const travelMinutes = curr.durationFromPreviousSeconds / 60;
        const attendanceMinutes = gapMinutes - travelMinutes;
        const expectedMinimum =
          DEFAULT_PREFERENCES.visitDurationMinutes +
          (prev.veterinarians - 1) * DEFAULT_PREFERENCES.minutesPerExtraVeterinarian;
        expect(attendanceMinutes).toBeGreaterThanOrEqual(expectedMinimum - 1);
      }
    }
  });

  it('marca as metricas como estimadas quando nao ha provider de mapas real', async () => {
    const result = await generatePlan(baseInput());
    expect(result.statistics.estimated).toBe(true);
    expect(result.warnings.some((w) => w.code === 'MATRIX_FALLBACK')).toBe(true);
  });
});

describe('motor de planejamento — casos de contorno', () => {
  it('explica a impossibilidade de 160 visitas em 10 dias com maximo de 8/dia', async () => {
    const input = baseInput({
      availableDays: buildDays(10),
      preferences: { ...DEFAULT_PREFERENCES, maxVisitsPerDay: 8, minVisitsPerDay: 4 },
    });
    const result = await generatePlan(input);
    expect(result.feasibility.feasible).toBe(false);
    expect(result.routes).toHaveLength(0);
    expect(result.feasibility.deficit).toBeGreaterThan(0);
    expect(result.feasibility.message).toContain('Não é possível');
  });

  it('recusa quando uma clinica sozinha tem mais veterinarios que o limite diario', async () => {
    const clinics = buildClinics();
    clinics[0] = { ...clinics[0], veterinarians: 30 };
    const input = baseInput({ clinics, preferences: { ...DEFAULT_PREFERENCES, maxVisitsPerDay: 14 } });
    const result = await generatePlan(input);
    expect(result.feasibility.feasible).toBe(false);
    expect(result.feasibility.oversizedClinics.some((c) => c.id === clinics[0].id)).toBe(true);
    expect(result.feasibility.message).toContain(clinics[0].name);
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
    const result = await generatePlan(baseInput({ monthlyTarget: 5000 }));
    expect(result.warnings.some((w) => w.code === 'TARGET_ABOVE_POOL')).toBe(true);
  });

  it('continua funcionando quando o provider de matriz falha (fallback)', async () => {
    const input = baseInput({
      resolveMatrix: async () => {
        throw new Error('Google Routes indisponível');
      },
    });
    const result = await generatePlan(input);
    expect(result.routes.flatMap((r) => r.stops).reduce((sum, s) => sum + s.veterinarians, 0)).toBe(160);
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
    const destination = { label: 'Escritório', lat: -23.576, lng: -46.689 };
    const result = await generatePlan(baseInput({ destination }));
    expect(result.routes.filter((r) => r.stops.length > 0).every((r) => r.destinationLabel === 'Escritório')).toBe(
      true,
    );
    expect(result.routes.flatMap((r) => r.stops).reduce((sum, s) => sum + s.veterinarians, 0)).toBe(160);
  });

  it('encadeia dias quando a origem e "ultima visita" (origin nulo)', async () => {
    const result = await generatePlan(baseInput({ origin: null }));
    expect(result.routes.flatMap((r) => r.stops).reduce((sum, s) => sum + s.veterinarians, 0)).toBe(160);
  });
});

describe('clinicas com visita dividida', () => {
  /**
   * Carteira pequena e controlada: uma clinica GRANDE (8 veterinarios,
   * dividida em 2 partes) mais varias clinicas de preenchimento, todas
   * proximas geograficamente para isolar o comportamento da separacao de
   * dias do resto do algoritmo (clustering geografico).
   */
  function buildSplitScenario(days: number, minDaysBetweenSplitVisits: number): PlannerInput {
    const big: PlannerClinic = {
      id: 'clinica-grande',
      name: 'Hospital Veterinário Central',
      category: 'CAT1',
      veterinarians: 8,
      visitSplits: 2,
      lat: -23.55,
      lng: -46.63,
    };
    const fillers: PlannerClinic[] = Array.from({ length: 14 }, (_, i) => ({
      id: `filler-${i}`,
      name: `Clínica de Apoio ${i + 1}`,
      category: 'CAT1',
      veterinarians: 1,
      lat: -23.55 + (i % 7) * 0.01,
      lng: -46.63 + Math.floor(i / 7) * 0.01,
    }));
    const clinics = [big, ...fillers];

    return {
      clinics,
      availableDays: buildDays(days),
      monthlyTarget: totalVeterinarians(clinics),
      month: 9,
      year: 2026,
      origin: null,
      destination: null,
      categoryRules: {
        ...DEFAULT_CATEGORY_RULES,
        rules: {
          CAT1: { frequency: 'monthly', targetCount: totalVeterinarians(clinics), enabled: true },
          CAT2: { frequency: 'alternating', targetCount: 0, enabled: false },
          CAT3: { frequency: 'alternating', targetCount: 0, enabled: false },
        },
      },
      preferences: {
        ...DEFAULT_PREFERENCES,
        minVisitsPerDay: 1,
        maxVisitsPerDay: 14,
        minDaysBetweenSplitVisits,
        candidateSolutions: 4,
      },
    };
  }

  it('agenda as duas partes em dias separados por pelo menos o intervalo minimo', async () => {
    const input = buildSplitScenario(22, 7);
    const result = await generatePlan(input);

    const bigStops = result.routes
      .map((route) => ({ route, stop: route.stops.find((s) => s.clinicId === 'clinica-grande') }))
      .filter((x): x is { route: (typeof result.routes)[number]; stop: NonNullable<typeof x.stop> } =>
        Boolean(x.stop),
      );

    expect(bigStops).toHaveLength(2);

    const dates = bigStops.map((x) => Date.parse(x.route.date)).sort((a, b) => a - b);
    const gapDays = (dates[1] - dates[0]) / 86_400_000;
    expect(gapDays).toBeGreaterThanOrEqual(7);

    // A soma dos veterinarios das duas partes recompoe o total original.
    expect(bigStops.reduce((sum, x) => sum + x.stop.veterinarians, 0)).toBe(8);

    // Cada parte se identifica corretamente (1/2 e 2/2).
    const parts = bigStops.map((x) => x.stop.part).sort();
    expect(parts).toEqual([1, 2]);
    expect(bigStops.every((x) => x.stop.totalParts === 2)).toBe(true);

    // O clinicId persistido e o da clinica REAL (sem sufixo interno de parte).
    expect(bigStops.every((x) => x.stop.clinicId === 'clinica-grande')).toBe(true);

    // Nao gera aviso: 22 dias uteis dao folga de sobra para 7 dias de intervalo.
    expect(result.warnings.some((w) => w.code === 'SPLIT_SEPARATION_UNMET')).toBe(false);
  });

  it('nunca perde a segunda parte, mesmo sem dias suficientes para a separacao ideal', async () => {
    // So 4 dias uteis no mes: impossivel abrir 7 dias de intervalo, mas a
    // visita nao pode simplesmente desaparecer.
    const input = buildSplitScenario(4, 7);
    const result = await generatePlan(input);

    const bigStops = result.routes.flatMap((r) => r.stops.filter((s) => s.clinicId === 'clinica-grande'));
    expect(bigStops).toHaveLength(2);
    expect(bigStops.reduce((sum, s) => sum + s.veterinarians, 0)).toBe(8);

    // E avisado explicitamente que a separacao ideal nao coube no mes.
    expect(result.warnings.some((w) => w.code === 'SPLIT_SEPARATION_UNMET')).toBe(true);
  });

  it('divide os veterinarios de forma parelha entre as partes', async () => {
    const input = buildSplitScenario(22, 7);
    const result = await generatePlan(input);
    const shares = result.routes
      .flatMap((r) => r.stops)
      .filter((s) => s.clinicId === 'clinica-grande')
      .map((s) => s.veterinarians)
      .sort((a, b) => a - b);
    // 8 veterinarios em 2 partes -> 4 e 4.
    expect(shares).toEqual([4, 4]);
  });

  it('uma clinica com visitSplits=1 nunca e dividida', async () => {
    const input = baseInput();
    const result = await generatePlan(input);
    const byClinicId = new Map<string, number>();
    for (const stop of result.routes.flatMap((r) => r.stops)) {
      byClinicId.set(stop.clinicId, (byClinicId.get(stop.clinicId) ?? 0) + 1);
    }
    expect([...byClinicId.values()].every((count) => count === 1)).toBe(true);
  });
});

describe('edicao manual da rota', () => {
  it('recalcula metricas ao reordenar mantendo a ordem escolhida', async () => {
    const result = await generatePlan(baseInput());
    const route = result.routes.find((r) => r.stops.length >= 3)!;
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
    const route = result.routes.find((r) => r.stops.length >= 2)!;
    const usedIds = new Set(result.routes.flatMap((r) => r.stops.map((s) => s.clinicId)));
    const pool = buildClinics().filter((c) => !usedIds.has(c.id));

    const alternatives = suggestAlternatives({
      route: { stops: route.stops, origin: route.origin, destination: route.destination },
      replaceSequence: route.stops[1]?.sequence ?? 1,
      pool: pool.length ? pool : buildClinics(),
      limit: 3,
    });

    expect(alternatives.length).toBeGreaterThan(0);
    const deltas = alternatives.map((a) => a.extraSeconds);
    expect(deltas).toEqual([...deltas].sort((a, b) => a - b));
  });
});
