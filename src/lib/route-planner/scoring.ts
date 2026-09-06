import { angleDelta, bearingDegrees, haversineMeters, meanRadiusMeters } from './geo';
import type { LatLng, RouteScoreBreakdown, ScoreWeights } from './types';

export interface ScoreInput {
  origin: LatLng | null;
  destination: LatLng | null;
  /** Paradas (clinicas) do dia — usadas para backtracking, desvio, concentracao e normalizacao. */
  stops: LatLng[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  /**
   * Visitas (veterinarios) contabilizadas no dia. Pode ser maior que
   * `stops.length` quando alguma clinica tem mais de um veterinario.
   */
  totalVisits: number;
  /** Meta de VISITAS (veterinarios) do dia — usada para penalizar desequilibrio. */
  targetVisits: number;
  weights: ScoreWeights;
  estimated: boolean;
}

/**
 * SCORE DA ROTA (secao 23).
 *
 * O score e derivado de um CUSTO ponderado, e todos os pesos vem de
 * configuracao (UserSettings.scoreWeights). Nenhum numero magico no algoritmo.
 *
 *   custo = minutos*w.duration + km*w.distance + inversoes*w.backtracking
 *         + kmDesvio*w.detour + kmRaio*w.concentration + |dif meta|*w.balance
 *
 * O score exibido (0-100) e uma normalizacao logistica do custo POR PARADA.
 * Normalizar por parada e essencial: senao um dia com 8 visitas sempre
 * "pontuaria pior" que um dia com 4, o que nao diz nada sobre qualidade.
 */
export function scoreRoute(input: ScoreInput): RouteScoreBreakdown {
  const { stops, origin, destination, weights } = input;

  const backtracking = countBacktracking(origin, stops, destination);
  const detourMeters = computeDetour(origin, stops, destination);
  const concentrationMeters = meanRadiusMeters(stops);

  const minutes = input.totalDurationSeconds / 60;
  const km = input.totalDistanceMeters / 1000;
  const detourKm = detourMeters / 1000;
  const concentrationKm = concentrationMeters / 1000;
  // O desequilibrio e medido em VISITAS, nao em paradas: a meta diaria que o
  // usuario configura (min/maxVisitsPerDay) conta veterinarios.
  const balanceGap = Math.abs(input.totalVisits - input.targetVisits);

  const cost =
    minutes * weights.duration +
    km * weights.distance +
    backtracking * weights.backtracking +
    detourKm * weights.detour +
    concentrationKm * weights.concentration +
    balanceGap * weights.balance;

  // Normalizamos pelo numero de PARADAS (nao de visitas): distancia, tempo e
  // backtracking escalam com deslocamentos entre clinicas, nao com quantos
  // veterinarios cada uma tem. Sem isso, uma clinica concentrada de 6
  // veterinarios "pontuaria pior" so por acumular mais minutos de atendimento,
  // o que nao reflete qualidade de ROTEIRIZACAO.
  const perStop = stops.length > 0 ? cost / stops.length : cost;
  const score = normalizeScore(perStop);

  return {
    score,
    cost,
    totalDistanceMeters: input.totalDistanceMeters,
    totalDurationSeconds: input.totalDurationSeconds,
    backtracking,
    detourMeters: Math.round(detourMeters),
    concentrationMeters: Math.round(concentrationMeters),
    estimated: input.estimated,
  };
}

/**
 * Curva de normalizacao. Um custo/parada de ~28 (referencia de um dia bem
 * concentrado em area urbana) mapeia perto de 90; ~90 mapeia perto de 40.
 * A curva e monotonica e limitada a [0, 100].
 */
function normalizeScore(costPerStop: number): number {
  const reference = 45;
  const steepness = 0.035;
  const raw = 100 / (1 + Math.exp(steepness * (costPerStop - reference)));
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

/**
 * Backtracking = inversoes bruscas de sentido.
 *
 * Para cada trio consecutivo (a, b, c), comparamos o azimute a->b com b->c.
 * Uma variacao acima de 110 graus significa "voltei por onde vim" — exatamente
 * o que o propagandista sente como rota ruim. Contamos ocorrencias.
 */
export function countBacktracking(
  origin: LatLng | null,
  stops: LatLng[],
  destination: LatLng | null,
): number {
  const path: LatLng[] = [];
  if (origin) path.push(origin);
  path.push(...stops);
  if (destination) path.push(destination);
  if (path.length < 3) return 0;

  let count = 0;
  for (let i = 0; i < path.length - 2; i += 1) {
    const inbound = bearingDegrees(path[i], path[i + 1]);
    const outbound = bearingDegrees(path[i + 1], path[i + 2]);
    if (angleDelta(inbound, outbound) > 110) count += 1;
  }
  return count;
}

/**
 * Desvio acumulado: quanto o caminho real excede o trajeto direto
 * origem -> destino (ou origem -> parada mais distante, quando nao ha destino).
 * E a medida de "quanto rodei alem do necessario".
 */
export function computeDetour(
  origin: LatLng | null,
  stops: LatLng[],
  destination: LatLng | null,
): number {
  if (stops.length === 0) return 0;

  const path: LatLng[] = [];
  if (origin) path.push(origin);
  path.push(...stops);
  if (destination) path.push(destination);

  let travelled = 0;
  for (let i = 0; i < path.length - 1; i += 1) travelled += haversineMeters(path[i], path[i + 1]);

  const anchorStart = origin ?? stops[0];
  const anchorEnd = destination ?? stops[stops.length - 1];
  const direct = haversineMeters(anchorStart, anchorEnd);

  return Math.max(0, travelled - direct);
}
