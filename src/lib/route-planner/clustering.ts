import { OPTIMIZATION_LIMITS } from './config';
import { createProjection } from './geo';
import { createRng } from './rng';
import type { LatLng } from './types';

export interface ClusterPoint extends LatLng {
  id: string;
  /** Peso da parada: quantas visitas (veterinarios) ela contabiliza. */
  weight: number;
}

export interface ClusterResult {
  /** Indices dos pontos em cada cluster. */
  clusters: number[][];
  centroids: Array<[number, number]>;
  /** Soma das distancias ao quadrado ao centroide (inercia). */
  inertia: number;
  /** Carga (soma de pesos) de cada cluster. */
  loads: number[];
  /** Quanto a solucao viola os limites min/max de cada dia. */
  capacityViolation: number;
}

export interface CapacityBounds {
  /** Alvo de visitas por dia (soft). */
  targets: number[];
  /** Limites duros de visitas por dia. */
  min: number;
  max: number;
}

/**
 * CLUSTERIZACAO CAPACITADA COM PESO — o coracao do diferencial do produto.
 *
 * Por que nao k-means puro: k-means livre produz grupos de tamanhos
 * arbitrarios (um dia com 20 visitas, outro com 2). Por que nao "as N mais
 * proximas": isso produz um dia otimo e varios pessimos, porque o algoritmo
 * consome as regioes densas primeiro e sobra uma carteira esparsa.
 *
 * A dificuldade extra deste dominio: a cota diaria conta VETERINARIOS, mas a
 * unidade que se move e a CLINICA, que e atomica. Um dia com teto de 14
 * visitas pode receber 14 clinicas de 1 veterinario ou 5 de 3 — e nao existe
 * "meia clinica". Isso torna o problema um empacotamento capacitado com peso,
 * nao uma particao de tamanho fixo.
 *
 * Pipeline:
 *  1. k-means++ para inicializar centroides bem espalhados;
 *  2. atribuicao gulosa por "regret" (arrependimento) — quem mais perde se nao
 *     ficar no seu melhor cluster decide primeiro — respeitando o teto de
 *     visitas e nao o numero de paradas;
 *  3. reparo: move clinicas de dias estourados para dias com folga, escolhendo
 *     sempre o movimento geograficamente mais barato;
 *  4. recalcula centroides e repete ate estabilizar;
 *  5. multiplos restarts, mantendo a melhor combinacao de compacidade e
 *     respeito aos limites.
 *
 * O passo 3 e o que o peso torna indispensavel: sem ele, uma clinica de 6
 * veterinarios que chega tarde na ordem de decisao nao cabe em lugar nenhum.
 */
export function balancedKMeans(
  points: ClusterPoint[],
  bounds: CapacityBounds,
  seed: number,
  restarts = OPTIMIZATION_LIMITS.kmeansRestarts,
): ClusterResult {
  const k = bounds.targets.length;
  if (k === 0) {
    return { clusters: [], centroids: [], inertia: 0, loads: [], capacityViolation: 0 };
  }
  if (points.length === 0) {
    return {
      clusters: bounds.targets.map(() => []),
      centroids: bounds.targets.map(() => [0, 0] as [number, number]),
      inertia: 0,
      loads: bounds.targets.map(() => 0),
      capacityViolation: 0,
    };
  }

  const projection = createProjection(points);
  const coords = points.map((p) => projection.project(p));
  const weights = points.map((p) => Math.max(1, Math.round(p.weight || 1)));

  let best: ClusterResult | null = null;

  for (let restart = 0; restart < restarts; restart += 1) {
    const rng = createRng(seed + restart * 7919);
    let centroids = kMeansPlusPlusInit(coords, k, rng);
    let clusters: number[][] = [];

    for (let iter = 0; iter < OPTIMIZATION_LIMITS.balancedAssignmentMaxIterations; iter += 1) {
      let next = assignByRegret(coords, weights, centroids, bounds);
      next = repairCapacity(next, coords, weights, centroids, bounds);
      const changed = !sameAssignment(clusters, next);
      clusters = next;
      centroids = recomputeCentroids(coords, clusters, centroids);
      if (!changed) break;
    }

    const inertia = computeInertia(coords, clusters, centroids);
    const loads = clusters.map((members) => members.reduce((sum, i) => sum + weights[i], 0));
    const capacityViolation = loads.reduce(
      (sum, load) => sum + Math.max(0, load - bounds.max) + Math.max(0, bounds.min - load),
      0,
    );

    // Respeitar os limites vale mais que compacidade: uma solucao compacta que
    // estoura o dia do usuario nao serve.
    const cost = inertia + capacityViolation * 1e12;
    const bestCost = best ? best.inertia + best.capacityViolation * 1e12 : Infinity;
    if (cost < bestCost) {
      best = { clusters, centroids, inertia, loads, capacityViolation };
    }
  }

  return best!;
}

/**
 * Reparo de capacidade.
 *
 * A atribuicao gulosa pode deixar dias acima do teto (quando uma clinica
 * pesada nao coube em lugar nenhum) ou abaixo do minimo. Aqui movemos clinicas
 * do dia mais sobrecarregado para o dia com folga que custe menos
 * geograficamente. Preferimos mover a clinica cujo deslocamento de centroide e
 * menor — normalmente uma que ja estava na fronteira entre duas regioes.
 */
function repairCapacity(
  clusters: number[][],
  coords: Array<[number, number]>,
  weights: number[],
  centroids: Array<[number, number]>,
  bounds: CapacityBounds,
): number[][] {
  const result = clusters.map((c) => [...c]);
  const load = result.map((members) => members.reduce((sum, i) => sum + weights[i], 0));

  for (let pass = 0; pass < OPTIMIZATION_LIMITS.capacityRepairPasses; pass += 1) {
    // Dia mais acima do teto.
    let source = -1;
    let worstExcess = 0;
    for (let i = 0; i < result.length; i += 1) {
      const excess = load[i] - bounds.max;
      if (excess > worstExcess) {
        worstExcess = excess;
        source = i;
      }
    }
    if (source === -1) break;

    let bestMove: { pointIndex: number; target: number; cost: number } | null = null;

    for (const pointIndex of result[source]) {
      const weight = weights[pointIndex];
      for (let target = 0; target < result.length; target += 1) {
        if (target === source) continue;
        if (load[target] + weight > bounds.max) continue;
        const cost =
          squaredDistance(coords[pointIndex], centroids[target]) -
          squaredDistance(coords[pointIndex], centroids[source]);
        if (!bestMove || cost < bestMove.cost) bestMove = { pointIndex, target, cost };
      }
    }

    if (!bestMove) break;

    result[source] = result[source].filter((i) => i !== bestMove!.pointIndex);
    result[bestMove.target].push(bestMove.pointIndex);
    load[source] -= weights[bestMove.pointIndex];
    load[bestMove.target] += weights[bestMove.pointIndex];
  }

  return result;
}

/** k-means++ : escolhe sementes proporcionalmente ao quadrado da distancia. */
function kMeansPlusPlusInit(
  coords: Array<[number, number]>,
  k: number,
  rng: () => number,
): Array<[number, number]> {
  const centroids: Array<[number, number]> = [];
  const first = Math.floor(rng() * coords.length);
  centroids.push([...coords[first]] as [number, number]);

  while (centroids.length < k) {
    const distances = coords.map((c) => {
      let min = Infinity;
      for (const centroid of centroids) {
        const d = squaredDistance(c, centroid);
        if (d < min) min = d;
      }
      return min;
    });
    const total = distances.reduce((a, b) => a + b, 0);
    if (total === 0) {
      centroids.push([...coords[Math.floor(rng() * coords.length)]] as [number, number]);
      continue;
    }
    let threshold = rng() * total;
    let index = 0;
    for (let i = 0; i < distances.length; i += 1) {
      threshold -= distances[i];
      if (threshold <= 0) {
        index = i;
        break;
      }
      index = i;
    }
    centroids.push([...coords[index]] as [number, number]);
  }

  return centroids;
}

/**
 * Atribuicao capacitada por arrependimento, ponderada por veterinarios.
 *
 * regret(p) = distancia ao 2o melhor cluster - distancia ao melhor cluster.
 * Pontos com regret alto sao os que mais "sofrem" se perderem a vaga, entao
 * decidem primeiro. E uma aproximacao gulosa barata do transporte otimo.
 *
 * Duas adaptacoes por causa do peso:
 *  - a vaga so e valida se `restante >= veterinarios da clinica`;
 *  - em caso de empate no regret, a clinica MAIS PESADA decide primeiro.
 *    Clinicas grandes sao as dificeis de encaixar; deixa-las para o fim e o
 *    caminho garantido para o estouro.
 */
function assignByRegret(
  coords: Array<[number, number]>,
  weights: number[],
  centroids: Array<[number, number]>,
  bounds: CapacityBounds,
): number[][] {
  const k = centroids.length;
  const remaining = bounds.targets.map((target) => Math.min(bounds.max, Math.max(target, bounds.min)));
  const load = new Array<number>(k).fill(0);
  const clusters: number[][] = Array.from({ length: k }, () => []);

  const ranked = coords.map((coord, index) => {
    const distances = centroids.map((c, ci) => ({ ci, d: squaredDistance(coord, c) }));
    distances.sort((a, b) => a.d - b.d);
    const regret = distances.length > 1 ? Math.sqrt(distances[1].d) - Math.sqrt(distances[0].d) : 0;
    return { index, order: distances.map((d) => d.ci), regret, weight: weights[index] };
  });

  ranked.sort((a, b) => b.regret - a.regret || b.weight - a.weight || a.index - b.index);

  for (const item of ranked) {
    let placed = false;

    // 1a tentativa: cabe dentro do alvo do dia.
    for (const ci of item.order) {
      if (remaining[ci] >= item.weight) {
        clusters[ci].push(item.index);
        remaining[ci] -= item.weight;
        load[ci] += item.weight;
        placed = true;
        break;
      }
    }

    // 2a tentativa: cabe dentro do teto duro, mesmo passando do alvo.
    if (!placed) {
      for (const ci of item.order) {
        if (load[ci] + item.weight <= bounds.max) {
          clusters[ci].push(item.index);
          remaining[ci] = Math.max(0, remaining[ci] - item.weight);
          load[ci] += item.weight;
          placed = true;
          break;
        }
      }
    }

    // Ultimo recurso: dia menos carregado. O reparo cuida do estouro depois.
    if (!placed) {
      let target = 0;
      for (let i = 1; i < k; i += 1) if (load[i] < load[target]) target = i;
      clusters[target].push(item.index);
      load[target] += item.weight;
      remaining[target] = Math.max(0, remaining[target] - item.weight);
    }
  }

  return clusters;
}

function recomputeCentroids(
  coords: Array<[number, number]>,
  clusters: number[][],
  previous: Array<[number, number]>,
): Array<[number, number]> {
  return clusters.map((members, i) => {
    if (members.length === 0) return previous[i];
    let x = 0;
    let y = 0;
    for (const index of members) {
      x += coords[index][0];
      y += coords[index][1];
    }
    return [x / members.length, y / members.length] as [number, number];
  });
}

function computeInertia(
  coords: Array<[number, number]>,
  clusters: number[][],
  centroids: Array<[number, number]>,
): number {
  let total = 0;
  clusters.forEach((members, i) => {
    for (const index of members) total += squaredDistance(coords[index], centroids[i]);
  });
  return total;
}

function sameAssignment(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].length !== b[i].length) return false;
    const setA = new Set(a[i]);
    for (const item of b[i]) if (!setA.has(item)) return false;
  }
  return true;
}

function squaredDistance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Ordena clusters geograficamente para atribui-los a dias consecutivos.
 *
 * Beneficio pratico: quando a origem e "ultima visita", dias vizinhos ficam em
 * regioes vizinhas. Resolvemos um TSP pequeno (>= centroides) por vizinho mais
 * proximo + 2-opt sobre os centroides — barato e suficiente.
 */
export function orderClustersGeographically(
  centroids: Array<[number, number]>,
  startFrom?: [number, number] | null,
): number[] {
  const n = centroids.length;
  if (n <= 2) return centroids.map((_, i) => i);

  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];

  let current: [number, number] =
    startFrom ??
    (centroids.reduce(
      (acc, c) => [acc[0] + c[0] / n, acc[1] + c[1] / n],
      [0, 0] as [number, number],
    ) as [number, number]);

  // Comeca pelo centroide mais distante do ponto de referencia quando nao ha
  // origem definida, para varrer a cidade de ponta a ponta em vez de zigzag.
  let first = 0;
  let bestD = startFrom ? Infinity : -Infinity;
  for (let i = 0; i < n; i += 1) {
    const d = squaredDistance(current, centroids[i]);
    if (startFrom ? d < bestD : d > bestD) {
      bestD = d;
      first = i;
    }
  }

  order.push(first);
  visited[first] = true;
  current = centroids[first];

  for (let step = 1; step < n; step += 1) {
    let bestIndex = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (visited[i]) continue;
      const d = squaredDistance(current, centroids[i]);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    order.push(bestIndex);
    visited[bestIndex] = true;
    current = centroids[bestIndex];
  }

  return twoOptOnCentroids(order, centroids);
}

function twoOptOnCentroids(order: number[], centroids: Array<[number, number]>): number[] {
  const path = [...order];
  const dist = (a: number, b: number) => Math.sqrt(squaredDistance(centroids[a], centroids[b]));
  let improved = true;
  let passes = 0;

  while (improved && passes < OPTIMIZATION_LIMITS.twoOptMaxPasses) {
    improved = false;
    passes += 1;
    for (let i = 0; i < path.length - 2; i += 1) {
      for (let j = i + 2; j < path.length - 1; j += 1) {
        const before = dist(path[i], path[i + 1]) + dist(path[j], path[j + 1]);
        const after = dist(path[i], path[j]) + dist(path[i + 1], path[j + 1]);
        if (after < before - 1e-6) {
          reverseSegment(path, i + 1, j);
          improved = true;
        }
      }
    }
  }

  return path;
}

function reverseSegment(arr: number[], from: number, to: number): void {
  let i = from;
  let j = to;
  while (i < j) {
    [arr[i], arr[j]] = [arr[j], arr[i]];
    i += 1;
    j -= 1;
  }
}
