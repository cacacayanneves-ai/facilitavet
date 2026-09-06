/**
 * Contrato do Claude (secoes 46-49).
 *
 * REGRA DE ARQUITETURA INEGOCIAVEL: o Claude e uma CAMADA DE LEITURA, nunca a
 * fonte da verdade. Ele recebe decisoes ja tomadas pelo motor determinístico e
 * devolve interpretacao em linguagem natural. Ele nao decide:
 *   - quais clinicas entram no mes;
 *   - em que dia cada uma cai;
 *   - em que ordem sao visitadas;
 *   - distancia, tempo, data ou categoria.
 *
 * Consequencia pratica: toda funcao aqui e opcional e falha em silencio
 * (retornando null). Se o Claude estiver fora do ar, o produto inteiro
 * continua funcionando — apenas sem os textos de analise.
 */

export interface RouteCandidateSummary {
  label: string;
  distanceKm: number;
  durationMinutes: number;
  backtracking: number;
  concentrationKm: number;
  score: number;
}

export interface RouteAnalysisRequest {
  date: string;
  requiredVisits: number;
  origin: string | null;
  destination: string | null;
  regionLabel: string;
  candidates: RouteCandidateSummary[];
  estimated: boolean;
}

export interface RouteAnalysisResult {
  /** Explicacao curta, pronta para exibir ao usuario. */
  summary: string;
  /** Rotulo da candidata que o Claude considera mais adequada, se opinou. */
  recommendation?: string;
  model: string;
}

export interface MonthAnalysisRequest {
  month: number;
  year: number;
  totalVisits: number;
  plannedDays: number;
  totalDistanceKm: number;
  totalDurationHours: number;
  averageScore: number;
  requiredCategories: string[];
  estimated: boolean;
  savingPercent: number | null;
  busiestRegions: Array<{ region: string; visits: number }>;
  warnings: string[];
}

export interface ClaudeProvider {
  readonly name: string;
  readonly available: boolean;
  analyzeRoute(request: RouteAnalysisRequest): Promise<RouteAnalysisResult | null>;
  analyzeMonth(request: MonthAnalysisRequest): Promise<RouteAnalysisResult | null>;
}
