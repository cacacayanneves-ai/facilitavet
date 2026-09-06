/**
 * Facilita Vet — Motor de planejamento (contratos)
 *
 * Este modulo e deliberadamente PURO: nao importa Prisma, Next, React nem
 * qualquer SDK externo. Recebe dados, devolve um plano. Isso permite testa-lo
 * isoladamente, roda-lo em outro runtime (worker, edge, fila) e trocar o
 * algoritmo interno sem tocar no resto do produto.
 */

export type CategoryCode = 'CAT1' | 'CAT2' | 'CAT3';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Clinica no formato que o motor entende. */
export interface PlannerClinic extends LatLng {
  id: string;
  name: string;
  category: CategoryCode;
  neighborhood?: string | null;
  city?: string | null;
  /** Prioridade comercial (maior = mais importante). Seam para o CRM futuro. */
  priority?: number;
  /** Data da ultima visita — usada para desempate na selecao da carteira. */
  lastVisitedAt?: Date | null;
}

export interface Anchor extends LatLng {
  label: string;
}

/** Frequencia de uma categoria dentro do ciclo comercial. */
export type CategoryFrequency = 'monthly' | 'alternating' | 'manual';

export interface CategoryRule {
  frequency: CategoryFrequency;
  /** Quantas clinicas desta categoria entram no mes em que ela e exigida. */
  targetCount: number;
  enabled: boolean;
}

/**
 * Regras comerciais configuraveis. NADA disso pode ficar hard-coded no
 * algoritmo: o ciclo Cat2/Cat3 e uma configuracao, nao um `if (mes === 1)`.
 */
export interface CategoryRuleSet {
  rules: Record<CategoryCode, CategoryRule>;
  /** Ordem do rodizio entre categorias `alternating`. */
  alternatingOrder: CategoryCode[];
  /** Mes/ano em que o rodizio comeca com `alternatingOrder[0]`. */
  anchorMonth: number; // 1-12
  anchorYear: number;
  /** Impede que uma clinica seja exigida por duas categorias no mesmo mes. */
  enforceExclusivity: boolean;
}

/** Pesos do score. Centralizados — nunca espalhados pelo codigo. */
export interface ScoreWeights {
  duration: number;
  distance: number;
  backtracking: number;
  detour: number;
  concentration: number;
  balance: number;
}

export interface PlannerPreferences {
  minVisitsPerDay: number;
  maxVisitsPerDay: number;
  visitDurationMinutes: number;
  bufferMinutes: number;
  workStartTime: string; // "08:00"
  workEndTime: string; // "18:00"
  lunchStart?: string | null;
  lunchEnd?: string | null;
  scoreWeights: ScoreWeights;
  /**
   * Quanto a agenda de um dia pode se afastar da distribuicao par para
   * acompanhar a densidade geografica da regiao. 1 = "alguns dias com 5,
   * alguns com 6". Valores altos desequilibram a agenda.
   */
  densityTolerance: number;
  /** Numero de solucoes candidatas geradas antes de escolher a melhor. */
  candidateSolutions: number;
  /** Semente para reprodutibilidade. */
  seed: number;
}

/** Um dia util disponivel para receber visitas. */
export interface AvailableDay {
  /** ISO date "YYYY-MM-DD" (sem timezone — o dia e um fato do calendario). */
  date: string;
  weekday: number; // 0=dom .. 6=sab
}

/**
 * Provedor de custo de deslocamento. O motor nunca chama o Google diretamente:
 * ele pede uma matriz a quem implementar esta interface. Assim trocamos
 * Google -> OSRM -> OR-Tools sem reescrever o algoritmo.
 */
export interface TravelMatrix {
  /** metros — matrix[i][j] = de i para j */
  distances: number[][];
  /** segundos */
  durations: number[][];
  provider: string;
  /** true quando a matriz veio de estimativa geometrica, nao de rota real. */
  estimated: boolean;
}

export interface TravelMatrixRequest {
  origins: LatLng[];
  destinations: LatLng[];
  /** Momento de referencia para transito (quando o provider suportar). */
  departureTime?: Date;
}

export type TravelMatrixResolver = (req: TravelMatrixRequest) => Promise<TravelMatrix>;

export interface PlannerInput {
  clinics: PlannerClinic[];
  availableDays: AvailableDay[];
  monthlyTarget: number;
  month: number; // 1-12
  year: number;
  origin: Anchor | null;
  destination: Anchor | null;
  categoryRules: CategoryRuleSet;
  preferences: PlannerPreferences;
  /** Opcional: sem isso o motor usa estimativa geometrica calibrada. */
  resolveMatrix?: TravelMatrixResolver;
}

export interface PlannedStop {
  clinicId: string;
  clinicName: string;
  category: CategoryCode;
  neighborhood?: string | null;
  lat: number;
  lng: number;
  sequence: number;
  /** "HH:MM" estimado de chegada. */
  estimatedArrival: string;
  estimatedDeparture: string;
  distanceFromPreviousMeters: number;
  durationFromPreviousSeconds: number;
}

export interface RouteScoreBreakdown {
  /** 0-100, maior e melhor. */
  score: number;
  /** Custo bruto ponderado (menor e melhor) — base do score. */
  cost: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  /** Numero de inversoes bruscas de sentido na sequencia. */
  backtracking: number;
  /** Metros de desvio acumulado em relacao ao caminho direto. */
  detourMeters: number;
  /** Raio medio do agrupamento (m) — menor = mais concentrado. */
  concentrationMeters: number;
  estimated: boolean;
}

export interface PlannedRoute {
  date: string;
  originLabel: string | null;
  origin: LatLng | null;
  destinationLabel: string | null;
  destination: LatLng | null;
  stops: PlannedStop[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  score: number;
  scoreBreakdown: RouteScoreBreakdown;
  regionLabel: string;
  estimated: boolean;
}

export interface PlannerWarning {
  code:
    | 'MISSING_COORDINATES'
    | 'CATEGORY_OVERLAP'
    | 'TARGET_ABOVE_POOL'
    | 'TARGET_BELOW_REQUIRED'
    | 'CAPACITY_TIGHT'
    | 'MATRIX_FALLBACK'
    | 'DAY_OVERFLOW';
  message: string;
  details?: Record<string, unknown>;
}

export interface FeasibilityReport {
  feasible: boolean;
  requiredVisits: number;
  availableDays: number;
  capacity: number;
  minimumCapacity: number;
  deficit: number;
  /** Dias necessarios no limite maximo por dia. */
  suggestedDays: number;
  suggestedMaxPerDay: number;
  message: string;
}

export interface PlannerStatistics {
  executionId: string;
  durationMs: number;
  strategy: string;
  selectedVisits: number;
  requiredCategories: CategoryCode[];
  perCategory: Record<CategoryCode, number>;
  plannedDays: number;
  averageVisitsPerDay: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  averageScore: number;
  matrixProvider: string;
  matrixElements: number;
  estimated: boolean;
  /** Comparacao contra a alternativa naive (ordem da carteira, sem clustering). */
  baseline: {
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    distanceSavingPercent: number;
    durationSavingSeconds: number;
  } | null;
  candidates: Array<{
    strategy: string;
    seed: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    averageScore: number;
  }>;
}

export interface PlannerResult {
  routes: PlannedRoute[];
  statistics: PlannerStatistics;
  warnings: PlannerWarning[];
  feasibility: FeasibilityReport;
  unassignedClinicIds: string[];
  skippedClinicIds: string[];
}

export interface PlannerLogEntry {
  step: number;
  label: string;
  detail?: string;
  elapsedMs: number;
}
