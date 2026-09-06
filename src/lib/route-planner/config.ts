import type { CategoryRuleSet, PlannerPreferences, ScoreWeights } from './types';

/**
 * Pesos padrao do score. Centralizados aqui e persistidos por usuario em
 * UserSettings.scoreWeights — o algoritmo nunca carrega numero magico.
 *
 * Interpretacao: quanto MAIOR o peso, mais o componente pesa no custo.
 * O score final e derivado do custo (menor custo => maior score).
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  /** minuto de deslocamento */
  duration: 1.0,
  /** quilometro rodado */
  distance: 0.6,
  /** cada inversao brusca de sentido */
  backtracking: 12,
  /** quilometro de desvio em relacao ao caminho direto */
  detour: 1.4,
  /** quilometro de raio medio do agrupamento do dia */
  concentration: 2.0,
  /** desvio da meta diaria de visitas (veterinarios) */
  balance: 3.0,
};

export const DEFAULT_CATEGORY_RULES: CategoryRuleSet = {
  // targetCount conta VISITAS (veterinarios), nao clinicas.
  rules: {
    CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
    CAT2: { frequency: 'alternating', targetCount: 80, enabled: true },
    CAT3: { frequency: 'alternating', targetCount: 80, enabled: true },
  },
  alternatingOrder: ['CAT2', 'CAT3'],
  anchorMonth: 1,
  anchorYear: 2026,
  enforceExclusivity: true,
};

export const DEFAULT_PREFERENCES: PlannerPreferences = {
  // Em VISITAS (veterinarios) por dia.
  minVisitsPerDay: 6,
  maxVisitsPerDay: 14,
  visitDurationMinutes: 30,
  minutesPerExtraVeterinarian: 10,
  bufferMinutes: 5,
  minDaysBetweenSplitVisits: 7,
  workStartTime: '08:00',
  workEndTime: '18:00',
  lunchStart: '12:00',
  lunchEnd: '13:30',
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
  densityTolerance: 1,
  candidateSolutions: 6,
  seed: 20260101,
};

/**
 * Calibracao do provider offline (estimativa geometrica).
 *
 * Nao existe "rota reta" no mundo real: a malha viaria impoe um fator de
 * sinuosidade sobre a distancia geodesica. 1.35 e um valor conservador para
 * malha urbana brasileira. A velocidade media urbana considera semaforos e
 * congestionamento tipico de horario comercial.
 *
 * Sempre que este provider for usado, o resultado e marcado `estimated: true`
 * e a interface avisa o usuario. Nunca apresentamos estimativa como medicao.
 */
export const OFFLINE_CALIBRATION = {
  detourFactor: 1.35,
  urbanSpeedKmh: 24,
  interurbanSpeedKmh: 62,
  /** Acima desta distancia (km) assumimos deslocamento interurbano. */
  interurbanThresholdKm: 25,
  /** Tempo fixo por parada (estacionar, achar o local) em segundos. */
  fixedStopOverheadSeconds: 120,
};

/** Limite duro para evitar loops patologicos no 2-opt. */
export const OPTIMIZATION_LIMITS = {
  twoOptMaxPasses: 60,
  orOptMaxPasses: 30,
  kmeansMaxIterations: 60,
  kmeansRestarts: 8,
  balancedAssignmentMaxIterations: 25,
  capacityRepairPasses: 200,
};
