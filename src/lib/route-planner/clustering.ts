import { OPTIMIZATION_LIMITS } from './config';
import { createProjection } from './geo';
import { createRng } from './rng';
import type { LatLng } from './types';

export interface ClusterPoint extends LatLng {
  id: string;
}

export interface ClusterResult {
  /** Indices dos pontos em cada cluster. */
  clusters: number[][];
  centroids: Array<[number, number]>;
  /** Soma das distancias ao quadrado ao centroide (inercia). */
  inertia: number;
}

/**
 * CLUSTERIZACAO CAPACITADA — o coracao do diferencial do produto.
 *
 * Por que nao k-means puro: k-means livre produz clusters de tamanhos
 * arbitrarios (um dia com 14 visitas, outro com 2). Por que nao "as N mais
 * proximas": isso produz um dia otimo e varios dias pessimos, porque o
 * algoritmo consome as regioes densas primeiro e sobra uma carteira esparsa.
 *
 * A solucao e um k-means BALANCEADO com capacidades:
 *  1. k-means++ para inicializar centroides bem espalhados;
 *  2. atribuicao por "regret" (arrependimento): quem tem mais a perder se nao
 *     ficar no seu melhor cluster escolhe primeiro, respeitando a capacidade;
 *  3. recalcula centroides e repete ate estabilizar;
 *  4. multiplos restarts, mantendo a melhor inercia.
 *
 * O passo 2 e o que impede o resultado degenerado: sem ele, o cluster mais
 * atraente lota e os ultimos pontos sao empurrados para qualquer lugar.
 */
export function balancedKMeans(
  points: ClusterPoint[],
  capacities: number[],
  seed: number,
  restarts = OPTIMIZATION_LIMITS.kmeansRestarts,
): ClusterResult {
  const k = capacities.length;
  if (k === 0) return { clusters: [], centroids: [], inertia: 0 };
  if (points.length === 0) {
    return { clusters: capacities.map(() => []), centroids: capacities.map(() => [0, 0]), inertia: 0 };
  }

  const projection = createProjection(points);
  const coords = points.map((p) => projection.project(p));

  let best: ClusterResult | null = null;

  for (let restart = 0; restart < restarts; restart += 1) {
    const rng = createRng(seed + restart * 7919);
    let centroids = kMeansPlusPlusInit(coords, k, rng);
    let clusters: number[][] = [];

    for (let iter = 0; iter < OPTIMIZATION_LIMITS.balancedAssignmentMaxIterations; iter += 1) {
      const next = assignByRegret(coords, centroids, capacities);
      const changed = !sameAssignment(clusters, next);
      clusters = next;
      centroids = recomputeCentroids(coords, clusters, centroids);
      if (!changed) break;
    }

    const inertia = computeInertia(coords, clusters, centroids);
    if (!best || inertia < best.inertia) {
      best = { clusters, centroids, inertia };
    }
  }

  return best!;
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
 * Atribuicao capacitada por arrependimento.
 *
 * regret(p) = distancia ao 2o melhor cluster - distancia ao melhor cluster.
 * Pontos com regret alto sao os que "sofrem" mais se perderem a vaga, entao
 * decidem primeiro. E uma aproximacao gulosa barata do transporte otimo, e na
 * pratica produz clusters visualmente coerentes.
 */
function assignByRegret(
  coords: Array<[number, number]>,
  centroids: Array<[number, number]>,
  capacities: number[],
): number[][] {
  const k = centroids.length;
  const remaining = [...capacities];
  const clusters: number[][] = Array.from({ length: k }, () => []);

  const ranked = coords.map((coord, index) => {
    const distances = centroids.map((c, ci) => ({ ci, d: squaredDistance(coord, c) }));
    distances.sort((a, b) => a.d - b.d);
    const regret = distances.length > 1 ? Math.sqrt(distances[1].d) - Math.sqrt(distances[0].d) : 0;
    return { index, order: distances.map((d) => d.ci), regret };
  });

  ranked.sort((a, b) => b.regret - a.regret || a.index - b.index);

  for (const item of ranked) {
    let placed = false;
    for (const ci of item.order) {
      if (remaining[ci] > 0) {
        clusters[ci].push(item.index);
        remaining[ci] -= 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Capacidade total < numero de pontos: coloca no cluster menos cheio.
      let target = 0;
      for (let i = 1; i < k; i += 1) {
        if (clusters[i].length < clusters[target].length) target = i;
      }
      clusters[target].push(item.index);
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
