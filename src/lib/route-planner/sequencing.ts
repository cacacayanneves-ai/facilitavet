import { OPTIMIZATION_LIMITS } from './config';

export interface SequenceProblem {
  /**
   * Matriz de custo quadrada indexada por "no". A rota do dia usa:
   *  - `startIndex` (origem, opcional)
   *  - `stopIndices` (clinicas)
   *  - `endIndex` (destino, opcional)
   */
  cost: number[][];
  stopIndices: number[];
  startIndex: number | null;
  endIndex: number | null;
}

export interface SequenceResult {
  order: number[];
  cost: number;
}

/**
 * SEQUENCIAMENTO DO DIA — TSP aberto com origem fixa e destino opcional.
 *
 * Pipeline classico e comprovado para instancias pequenas (5 a 10 paradas):
 *   1. multi-start nearest neighbour  -> solucao inicial razoavel em O(n^2);
 *   2. 2-opt                          -> remove cruzamentos;
 *   3. or-opt                         -> realoca segmentos de 1 a 3 paradas.
 *
 * Para n <= 8 isso encontra o otimo na pratica quase sempre, e roda em
 * microssegundos. A interface `SequenceProblem` e o ponto de troca: quando o
 * volume justificar, um solver (OR-Tools / VRP) entra aqui sem alterar o resto.
 */
export function optimizeSequence(problem: SequenceProblem): SequenceResult {
  const { stopIndices } = problem;
  if (stopIndices.length <= 1) {
    return { order: [...stopIndices], cost: evaluate(problem, stopIndices) };
  }

  let best: SequenceResult | null = null;

  // Multi-start: NN a partir da origem e tambem a partir de cada parada.
  const starts: Array<number | null> = [problem.startIndex];
  if (problem.startIndex === null) {
    starts.pop();
    for (const stop of stopIndices) starts.push(stop);
  } else {
    for (const stop of stopIndices) starts.push(stop);
  }

  for (const start of starts) {
    const initial = nearestNeighbour(problem, start);
    const improved = orOpt(problem, twoOpt(problem, initial));
    const cost = evaluate(problem, improved);
    if (!best || cost < best.cost) best = { order: improved, cost };
  }

  return best!;
}

function nearestNeighbour(problem: SequenceProblem, seedStop: number | null): number[] {
  const { cost, stopIndices, startIndex } = problem;
  const remaining = new Set(stopIndices);
  const order: number[] = [];

  let current: number;
  if (seedStop !== null && remaining.has(seedStop)) {
    current = seedStop;
    remaining.delete(seedStop);
    order.push(seedStop);
  } else if (startIndex !== null) {
    current = startIndex;
  } else {
    const first = stopIndices[0];
    current = first;
    remaining.delete(first);
    order.push(first);
  }

  while (remaining.size > 0) {
    let bestNode = -1;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      const c = cost[current][candidate];
      if (c < bestCost) {
        bestCost = c;
        bestNode = candidate;
      }
    }
    order.push(bestNode);
    remaining.delete(bestNode);
    current = bestNode;
  }

  return order;
}

/** 2-opt: inverte segmentos enquanto houver ganho. Elimina cruzamentos. */
function twoOpt(problem: SequenceProblem, order: number[]): number[] {
  const path = [...order];
  let improved = true;
  let passes = 0;

  while (improved && passes < OPTIMIZATION_LIMITS.twoOptMaxPasses) {
    improved = false;
    passes += 1;
    for (let i = 0; i < path.length - 1; i += 1) {
      for (let j = i + 1; j < path.length; j += 1) {
        const candidate = [...path];
        reverse(candidate, i, j);
        if (evaluate(problem, candidate) < evaluate(problem, path) - 1e-9) {
          path.splice(0, path.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  return path;
}

/**
 * or-opt: move segmentos de 1..3 paradas para outra posicao.
 * Corrige o caso classico "uma clinica isolada no meio da rota" que o 2-opt
 * sozinho nao resolve.
 */
function orOpt(problem: SequenceProblem, order: number[]): number[] {
  const path = [...order];
  let improved = true;
  let passes = 0;

  while (improved && passes < OPTIMIZATION_LIMITS.orOptMaxPasses) {
    improved = false;
    passes += 1;
    const baseline = evaluate(problem, path);

    for (let segLength = 1; segLength <= Math.min(3, path.length - 1); segLength += 1) {
      for (let from = 0; from + segLength <= path.length; from += 1) {
        const segment = path.slice(from, from + segLength);
        const rest = [...path.slice(0, from), ...path.slice(from + segLength)];

        for (let to = 0; to <= rest.length; to += 1) {
          if (to === from) continue;
          const candidate = [...rest.slice(0, to), ...segment, ...rest.slice(to)];
          if (evaluate(problem, candidate) < baseline - 1e-9) {
            path.splice(0, path.length, ...candidate);
            improved = true;
            break;
          }
          // Tambem testa o segmento invertido.
          const reversed = [...rest.slice(0, to), ...[...segment].reverse(), ...rest.slice(to)];
          if (evaluate(problem, reversed) < baseline - 1e-9) {
            path.splice(0, path.length, ...reversed);
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return path;
}

/** Custo total do percurso: origem -> paradas -> destino. */
export function evaluate(problem: SequenceProblem, order: number[]): number {
  const { cost, startIndex, endIndex } = problem;
  if (order.length === 0) {
    return startIndex !== null && endIndex !== null ? cost[startIndex][endIndex] : 0;
  }

  let total = 0;
  if (startIndex !== null) total += cost[startIndex][order[0]];
  for (let i = 0; i < order.length - 1; i += 1) total += cost[order[i]][order[i + 1]];
  if (endIndex !== null) total += cost[order[order.length - 1]][endIndex];
  return total;
}

function reverse(arr: number[], from: number, to: number): void {
  let i = from;
  let j = to;
  while (i < j) {
    [arr[i], arr[j]] = [arr[j], arr[i]];
    i += 1;
    j -= 1;
  }
}
