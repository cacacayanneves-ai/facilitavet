import type { PlannerWarning } from './types';

export interface DayCapacityPlan {
  /** Capacidade alvo por dia, na ordem dos dias disponiveis. */
  capacities: number[];
  warnings: PlannerWarning[];
}

/**
 * DISTRIBUICAO DA META PELOS DIAS (secoes 18 e 19).
 *
 * Distribui VISITAS (veterinarios), nao clinicas. 160 visitas em 20 dias vira
 * uma mistura equilibrada de 8 — e a soma fecha exatamente em 160.
 *
 * Este alvo e SOFT: como as clinicas sao atomicas e tem pesos diferentes, a
 * clusterizacao raramente fecha o alvo exato de cada dia. Os limites duros sao
 * min/max por dia; o alvo apenas orienta o empacotamento.
 *
 * Implementacao: base = floor(N/D), resto = N%D. Os `resto` dias que recebem a
 * visita extra sao escolhidos de forma ESPALHADA pelo mes (distribuicao de
 * Bresenham), nao os primeiros da lista. Assim a carga fica uniforme ao longo
 * das semanas em vez de concentrada no comeco.
 */
export function distributeDailyCapacity(
  totalVisits: number,
  dayCount: number,
  minPerDay: number,
  maxPerDay: number,
): DayCapacityPlan {
  const warnings: PlannerWarning[] = [];
  if (dayCount <= 0) {
    return { capacities: [], warnings };
  }

  const base = Math.floor(totalVisits / dayCount);
  const remainder = totalVisits % dayCount;

  const capacities = new Array<number>(dayCount).fill(base);

  // Bresenham: espalha `remainder` incrementos uniformemente entre os dias.
  if (remainder > 0) {
    for (let i = 0; i < remainder; i += 1) {
      const index = Math.floor((i * dayCount) / remainder + dayCount / (2 * remainder)) % dayCount;
      // Colisao (possivel em bordas) -> anda para o proximo dia livre.
      let target = index;
      let guard = 0;
      while (capacities[target] > base && guard < dayCount) {
        target = (target + 1) % dayCount;
        guard += 1;
      }
      capacities[target] += 1;
    }
  }

  if (base + (remainder > 0 ? 1 : 0) > maxPerDay) {
    warnings.push({
      code: 'DAY_OVERFLOW',
      message: `A meta exige ${base + 1} visitas em pelo menos um dia, acima do limite de ${maxPerDay} por dia.`,
      details: { base, maxPerDay },
    });
  }
  if (base < minPerDay && totalVisits > 0) {
    warnings.push({
      code: 'CAPACITY_TIGHT',
      message: `A meta gera dias com ${base} visita(s), abaixo do minimo preferido de ${minPerDay}.`,
      details: { base, minPerDay },
    });
  }

  return { capacities, warnings };
}

/**
 * Ajusta as capacidades a densidade geografica real (secao 19).
 *
 * Faz sentido dar uma visita a mais ao dia que caiu numa regiao densa e uma a
 * menos ao dia que pegou uma regiao esparsa — sem mudar o total.
 *
 * IMPORTANTE: o ajuste e limitado a `tolerance` visitas em relacao a
 * distribuicao par. Sem esse limite o algoritmo degenera em "um dia com 9 e
 * varios com 4", que fecha a conta mas quebra a regra de produto de agenda
 * equilibrada. Densidade e um ajuste fino, nao um vale-tudo.
 */
export function rebalanceByDensity(
  capacities: number[],
  densityWeights: number[],
  minPerDay: number,
  maxPerDay: number,
  tolerance = 1,
): number[] {
  const total = capacities.reduce((a, b) => a + b, 0);
  const dayCount = capacities.length;
  if (dayCount === 0 || total === 0) return capacities;

  const weightSum = densityWeights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return capacities;

  // Limites por dia: nunca se afastam mais que `tolerance` da distribuicao par.
  const lower = capacities.map((c) => Math.max(0, Math.max(minPerDay, c - tolerance)));
  const upper = capacities.map((c) => Math.min(maxPerDay, c + tolerance));

  const raw = densityWeights.map((w) => (w / weightSum) * total);
  const floors = raw.map((value, i) => clamp(Math.floor(value), lower[i], upper[i]));

  let assigned = floors.reduce((a, b) => a + b, 0);
  const remainders = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  let guard = 0;
  while (assigned < total && guard < total * 4) {
    let moved = false;
    for (const { index } of remainders) {
      if (assigned >= total) break;
      if (floors[index] < upper[index]) {
        floors[index] += 1;
        assigned += 1;
        moved = true;
      }
    }
    if (!moved) break;
    guard += 1;
  }

  guard = 0;
  while (assigned > total && guard < total * 4) {
    let moved = false;
    for (let i = remainders.length - 1; i >= 0; i -= 1) {
      if (assigned <= total) break;
      const index = remainders[i].index;
      if (floors[index] > lower[index]) {
        floors[index] -= 1;
        assigned -= 1;
        moved = true;
      }
    }
    if (!moved) {
      // Nao ha folga dentro da tolerancia: relaxa para fechar a conta exata.
      for (let i = remainders.length - 1; i >= 0 && assigned > total; i -= 1) {
        const index = remainders[i].index;
        if (floors[index] > 0) {
          floors[index] -= 1;
          assigned -= 1;
        }
      }
      break;
    }
    guard += 1;
  }

  return floors;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
