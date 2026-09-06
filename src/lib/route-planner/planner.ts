import { rebalanceByDensity, distributeDailyCapacity } from './balancing';
import { balancedKMeans, orderClustersGeographically, type ClusterPoint } from './clustering';
import { findCategoryOverlaps } from './category-cycle';
import { evaluateFeasibility } from './feasibility';
import { createProjection, estimateMatrix, haversineMeters } from './geo';
import { buildSchedule, minutesToTime } from './schedule';
import { scoreRoute } from './scoring';
import { selectClinicsForMonth } from './selection';
import { optimizeSequence, evaluate, type SequenceProblem } from './sequencing';
import type {
  CategoryCode,
  LatLng,
  PlannedRoute,
  PlannedStop,
  PlannerClinic,
  PlannerInput,
  PlannerLogEntry,
  PlannerResult,
  PlannerWarning,
  TravelMatrix,
} from './types';

export interface PlannerRunOptions {
  executionId?: string;
  referenceDate?: Date;
  onProgress?: (entry: PlannerLogEntry) => void;
}

/**
 * ============================================================================
 * MOTOR DE PLANEJAMENTO DO FACILITA VET
 * ============================================================================
 *
 * Implementa as 15 etapas descritas na especificacao do produto. E puro:
 * entra `PlannerInput`, sai `PlannerResult`. Nao conhece banco, HTTP nem UI.
 *
 * Divisao de responsabilidades (regra de arquitetura do produto):
 *   - Google Maps  -> fatos do mundo (onde fica, quanto demora, quanto anda).
 *   - Este motor    -> TODAS as decisoes (quem vai, em que dia, em que ordem).
 *   - Claude        -> leitura contextual sobre decisoes ja tomadas.
 *
 * O Claude NAO participa deste arquivo. Nao ha chamada de IA no caminho
 * critico do planejamento: se a IA cair, o roteiro continua sendo gerado.
 */
export async function generatePlan(
  input: PlannerInput,
  options: PlannerRunOptions = {},
): Promise<PlannerResult> {
  const startedAt = Date.now();
  const executionId = options.executionId ?? `plan_${Date.now().toString(36)}`;
  const referenceDate = options.referenceDate ?? new Date();
  const logs: PlannerLogEntry[] = [];
  const warnings: PlannerWarning[] = [];

  const step = (n: number, label: string, detail?: string) => {
    const entry: PlannerLogEntry = { step: n, label, detail, elapsedMs: Date.now() - startedAt };
    logs.push(entry);
    options.onProgress?.(entry);
  };

  const { preferences, categoryRules } = input;

  // -------------------------------------------------------------------------
  // Etapa 1 — Selecionar clinicas obrigatorias do mes
  // -------------------------------------------------------------------------
  step(1, 'Analisando carteira');
  const selection = selectClinicsForMonth(
    input.clinics,
    categoryRules,
    input.year,
    input.month,
    input.monthlyTarget,
    referenceDate,
  );
  warnings.push(...selection.warnings);

  // -------------------------------------------------------------------------
  // Etapa 2 — Validar categorias (exclusividade)
  // -------------------------------------------------------------------------
  step(2, 'Verificando categorias');
  if (categoryRules.enforceExclusivity) {
    const overlaps = findCategoryOverlaps(input.clinics);
    if (overlaps.length > 0) {
      warnings.push({
        code: 'CATEGORY_OVERLAP',
        message: `${overlaps.length} clinica(s) aparecem na carteira em mais de uma categoria. Uma clinica deve pertencer a apenas uma categoria.`,
        details: { overlaps: overlaps.slice(0, 20) },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Etapa 3 — Validar numero total de visitas / viabilidade
  // -------------------------------------------------------------------------
  step(3, 'Localizando clinicas');
  const selected = selection.selected;
  const dayCount = input.availableDays.length;
  const feasibility = evaluateFeasibility(
    selected.length,
    dayCount,
    preferences.minVisitsPerDay,
    preferences.maxVisitsPerDay,
  );

  if (!feasibility.feasible || selected.length === 0) {
    return {
      routes: [],
      statistics: emptyStatistics(executionId, Date.now() - startedAt, selection.perCategory, selection.requiredCategories, selected.length),
      warnings,
      feasibility,
      unassignedClinicIds: selected.map((c) => c.id),
      skippedClinicIds: selection.skippedNoCoordinates,
    };
  }

  // -------------------------------------------------------------------------
  // Etapas 4-8 — Coordenadas, regioes, grupos por dia e balanceamento
  // -------------------------------------------------------------------------
  step(4, 'Analisando regioes');

  const baseCapacity = distributeDailyCapacity(
    selected.length,
    dayCount,
    preferences.minVisitsPerDay,
    preferences.maxVisitsPerDay,
  );
  warnings.push(...baseCapacity.warnings);

  const points: ClusterPoint[] = selected.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng }));
  const clinicById = new Map(selected.map((c) => [c.id, c]));

  // -------------------------------------------------------------------------
  // Etapas 9-15 — Gera varias solucoes candidatas e escolhe a melhor
  // -------------------------------------------------------------------------
  step(5, 'Calculando deslocamentos');

  const candidates: SolutionCandidate[] = [];
  const strategies = buildStrategies(preferences.candidateSolutions, preferences.seed);

  step(6, 'Criando grupos');

  for (const strategy of strategies) {
    const capacities = strategy.densityAware
      ? densityAwareCapacities(points, baseCapacity.capacities, preferences, strategy.seed)
      : baseCapacity.capacities;

    const clustering = balancedKMeans(points, capacities, strategy.seed, strategy.restarts);
    candidates.push({
      strategy: strategy.name,
      seed: strategy.seed,
      clusters: clustering.clusters,
      centroids: clustering.centroids,
      inertia: clustering.inertia,
    });
  }

  step(7, 'Otimizando rotas');

  const matrixState = { provider: 'offline-geometric', elements: 0, estimated: true };
  const evaluated: EvaluatedSolution[] = [];

  for (const candidate of candidates) {
    const solution = await buildSolution({
      candidate,
      points,
      clinicById,
      input,
      matrixState,
    });
    evaluated.push(solution);
  }

  step(8, 'Comparando solucoes');

  evaluated.sort((a, b) => {
    // Criterio primario: score medio (maior e melhor). Empate: menor distancia.
    if (Math.abs(b.averageScore - a.averageScore) > 0.05) return b.averageScore - a.averageScore;
    return a.totalDistanceMeters - b.totalDistanceMeters;
  });

  const best = evaluated[0];

  // -------------------------------------------------------------------------
  // Comparacao com a linha de base (secao 34/67): so mostramos economia quando
  // ela foi realmente calculada. Nunca inventamos estatistica.
  // -------------------------------------------------------------------------
  const baseline = computeBaseline(selected, baseCapacity.capacities, input);
  const distanceSavingPercent =
    baseline.totalDistanceMeters > 0
      ? Math.round(
          ((baseline.totalDistanceMeters - best.totalDistanceMeters) / baseline.totalDistanceMeters) *
            1000,
        ) / 10
      : 0;

  step(9, 'Finalizando calendario');

  if (matrixState.estimated) {
    warnings.push({
      code: 'MATRIX_FALLBACK',
      message:
        'As distancias e os tempos sao estimativas geometricas calibradas. Configure a Google Routes API para obter dados reais de rota e transito.',
    });
  }

  const durationMs = Date.now() - startedAt;

  return {
    routes: best.routes,
    warnings,
    feasibility,
    unassignedClinicIds: [],
    skippedClinicIds: selection.skippedNoCoordinates,
    statistics: {
      executionId,
      durationMs,
      strategy: best.strategy,
      selectedVisits: selected.length,
      requiredCategories: selection.requiredCategories,
      perCategory: selection.perCategory,
      plannedDays: best.routes.filter((r) => r.stops.length > 0).length,
      averageVisitsPerDay:
        best.routes.length > 0
          ? Math.round((selected.length / best.routes.filter((r) => r.stops.length > 0).length) * 100) / 100
          : 0,
      totalDistanceMeters: best.totalDistanceMeters,
      totalDurationSeconds: best.totalDurationSeconds,
      averageScore: Math.round(best.averageScore * 10) / 10,
      matrixProvider: matrixState.provider,
      matrixElements: matrixState.elements,
      estimated: matrixState.estimated,
      baseline: {
        totalDistanceMeters: baseline.totalDistanceMeters,
        totalDurationSeconds: baseline.totalDurationSeconds,
        distanceSavingPercent,
        durationSavingSeconds: baseline.totalDurationSeconds - best.totalDurationSeconds,
      },
      candidates: evaluated.map((e) => ({
        strategy: e.strategy,
        seed: e.seed,
        totalDistanceMeters: e.totalDistanceMeters,
        totalDurationSeconds: e.totalDurationSeconds,
        averageScore: Math.round(e.averageScore * 10) / 10,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface SolutionCandidate {
  strategy: string;
  seed: number;
  clusters: number[][];
  centroids: Array<[number, number]>;
  inertia: number;
}

interface EvaluatedSolution {
  strategy: string;
  seed: number;
  routes: PlannedRoute[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  averageScore: number;
}

interface MatrixState {
  provider: string;
  elements: number;
  estimated: boolean;
}

function buildStrategies(count: number, seed: number) {
  const strategies: Array<{ name: string; seed: number; densityAware: boolean; restarts: number }> = [
    { name: 'balanced-kmeans', seed, densityAware: false, restarts: 8 },
    { name: 'density-aware', seed: seed + 101, densityAware: true, restarts: 8 },
  ];
  for (let i = strategies.length; i < Math.max(2, count); i += 1) {
    strategies.push({
      name: `balanced-kmeans-s${i}`,
      seed: seed + i * 2711,
      densityAware: i % 2 === 0,
      restarts: 6,
    });
  }
  return strategies;
}

/**
 * Ajusta a capacidade de cada dia a densidade da regiao que ele recebeu.
 * Roda um clustering exploratorio, mede quantas clinicas caem em cada regiao
 * e redistribui as vagas dentro dos limites min/max, mantendo o total exato.
 */
function densityAwareCapacities(
  points: ClusterPoint[],
  baseCapacities: number[],
  preferences: PlannerInput['preferences'],
  seed: number,
): number[] {
  const probe = balancedKMeans(points, baseCapacities, seed, 3);
  const weights = probe.clusters.map((members, i) => {
    if (members.length === 0) return 1;
    const centroid = probe.centroids[i];
    // Peso = densidade inversa: regiao compacta suporta mais visitas por dia.
    const spread =
      members.reduce((sum, index) => {
        const p = points[index];
        const dx = p.lng - centroid[0];
        const dy = p.lat - centroid[1];
        return sum + Math.sqrt(dx * dx + dy * dy);
      }, 0) / members.length;
    return 1 / (spread + 1e-6);
  });

  return rebalanceByDensity(
    baseCapacities,
    weights,
    preferences.minVisitsPerDay,
    preferences.maxVisitsPerDay,
    preferences.densityTolerance,
  );
}

async function buildSolution(args: {
  candidate: SolutionCandidate;
  points: ClusterPoint[];
  clinicById: Map<string, PlannerClinic>;
  input: PlannerInput;
  matrixState: MatrixState;
}): Promise<EvaluatedSolution> {
  const { candidate, points, clinicById, input, matrixState } = args;
  const { availableDays, origin, destination, preferences } = input;

  const projection = createProjection(points);
  const originProjected = origin ? projection.project(origin) : null;
  const clusterOrder = orderClustersGeographically(candidate.centroids, originProjected);

  // Meta ideal por dia: e contra ELA que o score mede desequilibrio. Comparar
  // o dia com ele mesmo zeraria o termo `balance` e o motor aceitaria de graca
  // um dia com 9 visitas ao lado de varios com 4.
  const idealStopsPerDay = availableDays.length > 0 ? points.length / availableDays.length : 0;

  const routes: PlannedRoute[] = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let scoreSum = 0;
  let scoredDays = 0;

  // Origem "ultima visita": o ponto de partida do dia N+1 e a ultima parada do
  // dia N. Isso e resolvido aqui, no encadeamento dos dias.
  let rollingOrigin: LatLng | null = origin;

  for (let dayIndex = 0; dayIndex < availableDays.length; dayIndex += 1) {
    const day = availableDays[dayIndex];
    const clusterIndex = clusterOrder[dayIndex];
    const members = clusterIndex === undefined ? [] : candidate.clusters[clusterIndex] ?? [];
    const dayClinics = members
      .map((index) => clinicById.get(points[index].id))
      .filter((c): c is PlannerClinic => Boolean(c));

    const route = await buildDayRoute({
      date: day.date,
      clinics: dayClinics,
      origin: rollingOrigin,
      destination,
      input,
      matrixState,
      targetStops: idealStopsPerDay,
    });

    routes.push(route);
    totalDistanceMeters += route.totalDistanceMeters;
    totalDurationSeconds += route.totalDurationSeconds;
    if (route.stops.length > 0) {
      scoreSum += route.score;
      scoredDays += 1;
      const last = route.stops[route.stops.length - 1];
      if (origin === null) rollingOrigin = { lat: last.lat, lng: last.lng };
    }
  }

  void preferences;

  return {
    strategy: candidate.strategy,
    seed: candidate.seed,
    routes,
    totalDistanceMeters,
    totalDurationSeconds,
    averageScore: scoredDays > 0 ? scoreSum / scoredDays : 0,
  };
}

async function buildDayRoute(args: {
  date: string;
  clinics: PlannerClinic[];
  origin: LatLng | null;
  destination: LatLng | null;
  input: PlannerInput;
  matrixState: MatrixState;
  targetStops: number;
}): Promise<PlannedRoute> {
  const { date, clinics, origin, destination, input, matrixState, targetStops } = args;
  const { preferences } = input;

  if (clinics.length === 0) {
    return {
      date,
      originLabel: input.origin?.label ?? null,
      origin,
      destinationLabel: input.destination?.label ?? null,
      destination,
      stops: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      score: 0,
      scoreBreakdown: {
        score: 0,
        cost: 0,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        backtracking: 0,
        detourMeters: 0,
        concentrationMeters: 0,
        estimated: matrixState.estimated,
      },
      regionLabel: '',
      estimated: matrixState.estimated,
    };
  }

  // Nos: [origem?] + clinicas + [destino?]
  const nodes: LatLng[] = [];
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  if (origin) {
    startIndex = nodes.length;
    nodes.push(origin);
  }
  const stopIndices = clinics.map((clinic) => {
    const index = nodes.length;
    nodes.push({ lat: clinic.lat, lng: clinic.lng });
    return index;
  });
  if (destination) {
    endIndex = nodes.length;
    nodes.push(destination);
  }

  // Matriz apenas DENTRO do dia: ~(n+2)^2 elementos em vez de 100x100.
  // Essa e a decisao central de custo do produto (secao 77).
  const matrix = await resolveMatrix(nodes, input, matrixState, date, preferences.workStartTime);

  // Custo de otimizacao: duracao e o que o propagandista sente. A distancia
  // entra com peso menor para desempatar rotas de tempo parecido.
  const cost = matrix.durations.map((row, i) =>
    row.map((value, j) => value + matrix.distances[i][j] * 0.02),
  );

  const problem: SequenceProblem = { cost, stopIndices, startIndex, endIndex };
  const { order } = optimizeSequence(problem);

  const legDistances: number[] = [];
  const legDurations: number[] = [];
  let previous = startIndex;
  for (const nodeIndex of order) {
    if (previous === null) {
      legDistances.push(0);
      legDurations.push(0);
    } else {
      legDistances.push(matrix.distances[previous][nodeIndex]);
      legDurations.push(matrix.durations[previous][nodeIndex]);
    }
    previous = nodeIndex;
  }

  let totalDistance = legDistances.reduce((a, b) => a + b, 0);
  let totalDuration = legDurations.reduce((a, b) => a + b, 0);
  if (endIndex !== null && previous !== null) {
    totalDistance += matrix.distances[previous][endIndex];
    totalDuration += matrix.durations[previous][endIndex];
  }

  const schedule = buildSchedule(legDurations, {
    workStartTime: preferences.workStartTime,
    workEndTime: preferences.workEndTime,
    lunchStart: preferences.lunchStart,
    lunchEnd: preferences.lunchEnd,
    visitDurationMinutes: preferences.visitDurationMinutes,
    bufferMinutes: preferences.bufferMinutes,
  });

  const orderedClinics = order.map((nodeIndex) => clinics[stopIndices.indexOf(nodeIndex)]);

  const stops: PlannedStop[] = orderedClinics.map((clinic, i) => ({
    clinicId: clinic.id,
    clinicName: clinic.name,
    category: clinic.category,
    neighborhood: clinic.neighborhood ?? null,
    lat: clinic.lat,
    lng: clinic.lng,
    sequence: i + 1,
    estimatedArrival: minutesToTime(schedule[i].arrivalMinutes),
    estimatedDeparture: minutesToTime(schedule[i].departureMinutes),
    distanceFromPreviousMeters: Math.round(legDistances[i]),
    durationFromPreviousSeconds: Math.round(legDurations[i]),
  }));

  const breakdown = scoreRoute({
    origin,
    destination,
    stops: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    totalDistanceMeters: Math.round(totalDistance),
    totalDurationSeconds: Math.round(totalDuration),
    targetStops,
    weights: preferences.scoreWeights,
    estimated: matrix.estimated,
  });

  return {
    date,
    originLabel: input.origin?.label ?? null,
    origin,
    destinationLabel: input.destination?.label ?? null,
    destination,
    stops,
    totalDistanceMeters: Math.round(totalDistance),
    totalDurationSeconds: Math.round(totalDuration),
    score: breakdown.score,
    scoreBreakdown: breakdown,
    regionLabel: buildRegionLabel(orderedClinics),
    estimated: matrix.estimated,
  };
}

async function resolveMatrix(
  nodes: LatLng[],
  input: PlannerInput,
  matrixState: MatrixState,
  date: string,
  startTime: string,
): Promise<TravelMatrix> {
  if (!input.resolveMatrix) {
    matrixState.elements += nodes.length * nodes.length;
    return estimateMatrix({ origins: nodes, destinations: nodes });
  }

  try {
    const [h, m] = startTime.split(':').map(Number);
    const departureTime = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    const matrix = await input.resolveMatrix({
      origins: nodes,
      destinations: nodes,
      departureTime: Number.isNaN(departureTime.getTime()) ? undefined : departureTime,
    });
    matrixState.elements += nodes.length * nodes.length;
    matrixState.provider = matrix.provider;
    matrixState.estimated = matrixState.estimated && matrix.estimated;
    if (!matrix.estimated) matrixState.estimated = false;
    return matrix;
  } catch {
    // FALLBACK (secao 49): se o provedor de mapas cair, o planejamento
    // continua com estimativa geometrica em vez de falhar.
    matrixState.elements += nodes.length * nodes.length;
    matrixState.provider = 'offline-geometric';
    matrixState.estimated = true;
    return estimateMatrix({ origins: nodes, destinations: nodes });
  }
}

/** Rotulo legivel da regiao do dia: "Vila Mariana +2 bairros". */
function buildRegionLabel(clinics: PlannerClinic[]): string {
  const counts = new Map<string, number>();
  for (const clinic of clinics) {
    const key = clinic.neighborhood?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return clinics[0]?.city ?? '';

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  const main = sorted[0][0];
  const others = sorted.length - 1;
  if (others === 0) return main;
  return `${main} +${others} bairro${others > 1 ? 's' : ''}`;
}

/**
 * LINHA DE BASE para a comparacao honesta de economia.
 *
 * Simula o que o profissional faria sem o produto: dividir a carteira pelos
 * dias na ordem em que ela esta (ordem alfabetica/planilha) e visitar na
 * mesma ordem. E o cenario real de quem usa planilha — nao um espantalho.
 * Usa a MESMA funcao de estimativa das rotas otimizadas, entao a comparacao
 * e coerente. Se a comparacao nao puder ser feita, o produto nao mostra
 * numero de economia (secao 34).
 */
function computeBaseline(
  clinics: PlannerClinic[],
  capacities: number[],
  input: PlannerInput,
): { totalDistanceMeters: number; totalDurationSeconds: number } {
  const ordered = [...clinics].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  let cursor = 0;
  let totalDistance = 0;
  let totalDuration = 0;

  for (const capacity of capacities) {
    const dayClinics = ordered.slice(cursor, cursor + capacity);
    cursor += capacity;
    if (dayClinics.length === 0) continue;

    const nodes: LatLng[] = [];
    if (input.origin) nodes.push(input.origin);
    nodes.push(...dayClinics.map((c) => ({ lat: c.lat, lng: c.lng })));
    if (input.destination) nodes.push(input.destination);

    const matrix = estimateMatrix({ origins: nodes, destinations: nodes });
    for (let i = 0; i < nodes.length - 1; i += 1) {
      totalDistance += matrix.distances[i][i + 1];
      totalDuration += matrix.durations[i][i + 1];
    }
  }

  return { totalDistanceMeters: Math.round(totalDistance), totalDurationSeconds: Math.round(totalDuration) };
}

function emptyStatistics(
  executionId: string,
  durationMs: number,
  perCategory: Record<CategoryCode, number>,
  requiredCategories: CategoryCode[],
  selectedVisits: number,
): PlannerResult['statistics'] {
  return {
    executionId,
    durationMs,
    strategy: 'none',
    selectedVisits,
    requiredCategories,
    perCategory,
    plannedDays: 0,
    averageVisitsPerDay: 0,
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    averageScore: 0,
    matrixProvider: 'none',
    matrixElements: 0,
    estimated: true,
    baseline: null,
    candidates: [],
  };
}

/** Recalculo de uma rota apos edicao manual (arrastar / trocar clinica). */
export async function recalculateRoute(args: {
  date: string;
  clinics: PlannerClinic[];
  origin: LatLng | null;
  destination: LatLng | null;
  input: Pick<PlannerInput, 'preferences' | 'origin' | 'destination' | 'resolveMatrix'>;
  /** Quando true respeita a ordem informada; quando false reotimiza. */
  keepOrder: boolean;
  targetStops?: number;
}): Promise<PlannedRoute> {
  const matrixState: MatrixState = { provider: 'offline-geometric', elements: 0, estimated: true };
  const fullInput = {
    ...args.input,
    clinics: args.clinics,
    availableDays: [],
    monthlyTarget: args.clinics.length,
    month: 1,
    year: 2026,
    categoryRules: null as never,
  } as unknown as PlannerInput;

  if (!args.keepOrder) {
    return buildDayRoute({
      date: args.date,
      clinics: args.clinics,
      origin: args.origin,
      destination: args.destination,
      input: fullInput,
      matrixState,
      targetStops: args.targetStops ?? args.clinics.length,
    });
  }

  // Ordem manual: usamos o mesmo pipeline de metricas, mas sem reordenar.
  const route = await buildDayRouteFixedOrder({
    date: args.date,
    clinics: args.clinics,
    origin: args.origin,
    destination: args.destination,
    input: fullInput,
    matrixState,
    targetStops: args.targetStops ?? args.clinics.length,
  });
  return route;
}

async function buildDayRouteFixedOrder(args: {
  date: string;
  clinics: PlannerClinic[];
  origin: LatLng | null;
  destination: LatLng | null;
  input: PlannerInput;
  matrixState: MatrixState;
  targetStops: number;
}): Promise<PlannedRoute> {
  const { date, clinics, origin, destination, input, matrixState, targetStops } = args;
  const { preferences } = input;

  if (clinics.length === 0) {
    return buildDayRoute({ ...args, clinics: [] });
  }

  const nodes: LatLng[] = [];
  let startIndex: number | null = null;
  let endIndex: number | null = null;
  if (origin) {
    startIndex = nodes.length;
    nodes.push(origin);
  }
  const stopIndices = clinics.map((clinic) => {
    const index = nodes.length;
    nodes.push({ lat: clinic.lat, lng: clinic.lng });
    return index;
  });
  if (destination) {
    endIndex = nodes.length;
    nodes.push(destination);
  }

  const matrix = await resolveMatrix(nodes, input, matrixState, date, preferences.workStartTime);

  const legDistances: number[] = [];
  const legDurations: number[] = [];
  let previous = startIndex;
  for (const nodeIndex of stopIndices) {
    if (previous === null) {
      legDistances.push(0);
      legDurations.push(0);
    } else {
      legDistances.push(matrix.distances[previous][nodeIndex]);
      legDurations.push(matrix.durations[previous][nodeIndex]);
    }
    previous = nodeIndex;
  }

  let totalDistance = legDistances.reduce((a, b) => a + b, 0);
  let totalDuration = legDurations.reduce((a, b) => a + b, 0);
  if (endIndex !== null && previous !== null) {
    totalDistance += matrix.distances[previous][endIndex];
    totalDuration += matrix.durations[previous][endIndex];
  }

  const schedule = buildSchedule(legDurations, {
    workStartTime: preferences.workStartTime,
    workEndTime: preferences.workEndTime,
    lunchStart: preferences.lunchStart,
    lunchEnd: preferences.lunchEnd,
    visitDurationMinutes: preferences.visitDurationMinutes,
    bufferMinutes: preferences.bufferMinutes,
  });

  const stops: PlannedStop[] = clinics.map((clinic, i) => ({
    clinicId: clinic.id,
    clinicName: clinic.name,
    category: clinic.category,
    neighborhood: clinic.neighborhood ?? null,
    lat: clinic.lat,
    lng: clinic.lng,
    sequence: i + 1,
    estimatedArrival: minutesToTime(schedule[i].arrivalMinutes),
    estimatedDeparture: minutesToTime(schedule[i].departureMinutes),
    distanceFromPreviousMeters: Math.round(legDistances[i]),
    durationFromPreviousSeconds: Math.round(legDurations[i]),
  }));

  const breakdown = scoreRoute({
    origin,
    destination,
    stops: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    totalDistanceMeters: Math.round(totalDistance),
    totalDurationSeconds: Math.round(totalDuration),
    targetStops,
    weights: preferences.scoreWeights,
    estimated: matrix.estimated,
  });

  return {
    date,
    originLabel: input.origin?.label ?? null,
    origin,
    destinationLabel: input.destination?.label ?? null,
    destination,
    stops,
    totalDistanceMeters: Math.round(totalDistance),
    totalDurationSeconds: Math.round(totalDuration),
    score: breakdown.score,
    scoreBreakdown: breakdown,
    regionLabel: buildRegionLabel(clinics),
    estimated: matrix.estimated,
  };
}

/**
 * Sugere clinicas alternativas para uma parada (secao 31 — "Trocar visita").
 * Retorna candidatas ordenadas pelo custo adicional REAL de inseri-las na
 * rota — nao pela distancia em linha reta ate a clinica trocada.
 */
export function suggestAlternatives(args: {
  route: { stops: Array<{ clinicId: string; lat: number; lng: number }>; origin: LatLng | null; destination: LatLng | null };
  replaceSequence: number;
  pool: PlannerClinic[];
  limit?: number;
}): Array<{ clinic: PlannerClinic; extraSeconds: number; extraMeters: number }> {
  const { route, replaceSequence, pool } = args;
  const limit = args.limit ?? 6;
  const index = replaceSequence - 1;
  if (index < 0 || index >= route.stops.length) return [];

  const currentIds = new Set(route.stops.map((s) => s.clinicId));
  const before = index === 0 ? route.origin : route.stops[index - 1];
  const after = index === route.stops.length - 1 ? route.destination : route.stops[index + 1];

  const baseCost = legCost(before, route.stops[index], after);

  return pool
    .filter((clinic) => !currentIds.has(clinic.id))
    .map((clinic) => {
      const candidateCost = legCost(before, { lat: clinic.lat, lng: clinic.lng }, after);
      return {
        clinic,
        extraSeconds: Math.round(candidateCost.seconds - baseCost.seconds),
        extraMeters: Math.round(candidateCost.meters - baseCost.meters),
      };
    })
    .sort((a, b) => a.extraSeconds - b.extraSeconds || a.extraMeters - b.extraMeters)
    .slice(0, limit);
}

function legCost(
  before: LatLng | null,
  target: LatLng,
  after: LatLng | null,
): { seconds: number; meters: number } {
  const nodes: LatLng[] = [];
  if (before) nodes.push(before);
  nodes.push(target);
  if (after) nodes.push(after);
  const matrix = estimateMatrix({ origins: nodes, destinations: nodes });
  let seconds = 0;
  let meters = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) {
    seconds += matrix.durations[i][i + 1];
    meters += matrix.distances[i][i + 1];
  }
  return { seconds, meters };
}

export { haversineMeters, evaluate };
