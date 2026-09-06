import { visitWeightOf } from './selection';
import type { AvailableDay, PlannerClinic } from './types';

/**
 * VISITAS DIVIDIDAS.
 *
 * Algumas clinicas tem veterinarios demais para uma unica passagem: o
 * propagandista prefere voltar noutro dia e falar com o restante, em vez de
 * concentrar tudo numa parada excepcionalmente longa. Isso e uma decisao
 * comercial marcada CLINICA A CLINICA (`Clinic.visitSplits`), nao uma
 * consequencia automatica do numero de veterinarios.
 *
 * Regra de negocio: as partes da mesma clinica precisam cair em dias
 * separados por pelo menos `minDaysBetweenSplitVisits` dias corridos — nunca
 * na mesma semana.
 *
 * Isso quebra a premissa "uma clinica = uma parada atomica" que o resto do
 * motor assume. A solucao em duas fases:
 *
 *   1. `expandSplitClinics` — divide cada clinica marcada em N pseudo-clinicas
 *      (uma por parte), cada uma com sua fatia dos veterinarios. A PRIMEIRA
 *      parte entra no pool normal de clusterizacao geografica (ela decide,
 *      pela demanda geografica de sempre, qual e o melhor dia). As DEMAIS
 *      partes ficam de fora, "adiadas".
 *
 *   2. `insertDeferredParts` — depois que a primeira parte de cada clinica ja
 *      tem um dia definido (pos-clusterizacao), insere as partes adiadas uma a
 *      uma, escolhendo entre os dias do mes aquele que (a) respeita o
 *      intervalo minimo em relacao a TODAS as partes ja posicionadas da mesma
 *      clinica, (b) tem espaco dentro do teto diario, e (c) fica
 *      geograficamente mais barato. Isso evita ter que "desfazer" uma boa
 *      decisao geografica ja tomada — so preenchemos o que falta.
 */

const PART_SEPARATOR = '::parte';

export function isSplitPartId(clinicId: string): boolean {
  return clinicId.includes(PART_SEPARATOR);
}

/** Id da clinica real na base a partir do id (possivelmente de uma parte). */
export function realClinicId(plannerClinicId: string): string {
  const index = plannerClinicId.indexOf(PART_SEPARATOR);
  return index === -1 ? plannerClinicId : plannerClinicId.slice(0, index);
}

export interface ExpandSplitResult {
  /** Clinicas normais + a PRIMEIRA parte de cada clinica dividida. */
  pool: PlannerClinic[];
  /** Partes 2..N de cada clinica dividida, ainda sem dia atribuido. */
  deferred: PlannerClinic[];
  /** Quantas clinicas da selecao foram efetivamente divididas. */
  splitCount: number;
}

/**
 * Divide veterinarios em N fatias o mais parelhas possivel.
 * 7 veterinarios em 2 partes -> [4, 3]. A ordem nao importa aqui: a primeira
 * fatia (maior ou igual as demais) vai para a parte que entra na
 * clusterizacao normal.
 */
export function splitVeterinarianCount(total: number, parts: number): number[] {
  const safeTotal = Math.max(1, Math.round(total || 1));
  const safeParts = Math.max(1, Math.round(parts || 1));
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal % safeParts;
  return Array.from({ length: safeParts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function expandSplitClinics(clinics: PlannerClinic[]): ExpandSplitResult {
  const pool: PlannerClinic[] = [];
  const deferred: PlannerClinic[] = [];
  let splitCount = 0;

  for (const clinic of clinics) {
    const parts = Math.max(1, Math.round(clinic.visitSplits || 1));

    if (parts <= 1) {
      pool.push(clinic);
      continue;
    }

    splitCount += 1;
    const shares = splitVeterinarianCount(visitWeightOf(clinic), parts);

    for (let i = 0; i < parts; i += 1) {
      const part: PlannerClinic = {
        ...clinic,
        id: `${clinic.id}${PART_SEPARATOR}${i + 1}`,
        name: `${clinic.name} (parte ${i + 1}/${parts})`,
        veterinarians: shares[i],
        visitSplits: 1,
        splitPart: i + 1,
        splitTotal: parts,
        splitOf: clinic.id,
      };
      if (i === 0) pool.push(part);
      else deferred.push(part);
    }
  }

  return { pool, deferred, splitCount };
}

function daysBetweenDates(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / msPerDay);
}

export interface InsertDeferredArgs {
  /** Clusters de VISITAS ja atribuidos, indexados por "slot" de cluster. */
  clusters: number[][];
  /** slot de cluster para cada indice de dia (0 = primeiro dia disponivel). */
  clusterOrder: number[];
  /** Pontos ja usados na clusterizacao (posicoes 0..N-1, alinhadas a `clusters`). */
  points: Array<{ id: string; lat: number; lng: number }>;
  /** Peso (visitas) de cada ponto, mesmo indice de `points`. */
  weights: number[];
  centroids: Array<[number, number]>;
  availableDays: AvailableDay[];
  deferred: PlannerClinic[];
  minDaysBetweenSplitVisits: number;
  /** Teto de visitas por dia — nunca ultrapassado, exceto para nao perder a regra de separacao. */
  maxPerDay: number;
  /**
   * Projeta lat/lng para o MESMO plano metrico local usado pelos centroides
   * (ver `createProjection` em geo.ts). Sem isso, comparar graus decimais
   * contra centroides em metros produziria um "custo geografico" sem
   * relacao com a distancia real.
   */
  project: (point: { lat: number; lng: number }) => [number, number];
}

export interface InsertDeferredResult {
  clusters: number[][];
  points: Array<{ id: string; lat: number; lng: number }>;
  weights: number[];
  warnings: Array<{ groupId: string; message: string }>;
}

/**
 * Insere as partes adiadas respeitando o intervalo minimo entre partes da
 * mesma clinica.
 *
 * Processa clinica por clinica, parte por parte, sempre verificando contra
 * TODAS as partes ja posicionadas daquela clinica (a primeira, vinda da
 * clusterizacao normal, mais quaisquer outras ja inseridas nesta funcao).
 * Verificar contra todas — nao so a ultima — garante que a restricao vale
 * para TODOS os pares, nao so pares consecutivos.
 */
export function insertDeferredParts(args: InsertDeferredArgs): InsertDeferredResult {
  const { availableDays, minDaysBetweenSplitVisits, maxPerDay } = args;
  const clusters = args.clusters.map((c) => [...c]);
  const points = [...args.points];
  const weights = [...args.weights];
  const warnings: Array<{ groupId: string; message: string }> = [];

  if (availableDays.length === 0 || args.deferred.length === 0) {
    return { clusters, points, weights, warnings };
  }

  // slot de cluster -> indice de dia (inverso de clusterOrder).
  const slotToDayIndex = new Map<number, number>();
  args.clusterOrder.forEach((slot, dayIndex) => slotToDayIndex.set(slot, dayIndex));

  // indice de ponto -> indice de dia (calendario), reconstruido a partir dos clusters atuais.
  const pointDayIndex = new Map<number, number>();
  clusters.forEach((members, slot) => {
    const dayIndex = slotToDayIndex.get(slot);
    if (dayIndex === undefined) return;
    for (const member of members) pointDayIndex.set(member, dayIndex);
  });

  const loadOfSlot = (slot: number) => clusters[slot].reduce((sum, i) => sum + weights[i], 0);

  // Agrupa as partes adiadas por clinica de origem, na ordem das partes.
  const byGroup = new Map<string, PlannerClinic[]>();
  for (const part of args.deferred) {
    const groupId = part.splitOf ?? part.id;
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId)!.push(part);
  }
  for (const parts of byGroup.values()) parts.sort((a, b) => (a.splitPart ?? 0) - (b.splitPart ?? 0));

  for (const [groupId, parts] of byGroup) {
    // Dias ja ocupados por partes desta clinica (comeca com a parte 1, ja
    // posicionada pela clusterizacao normal).
    const occupiedDayIndices: number[] = [];
    for (const [pointIndex, dayIndex] of pointDayIndex) {
      if (points[pointIndex]?.id === groupId || points[pointIndex]?.id.startsWith(`${groupId}::parte`)) {
        occupiedDayIndices.push(dayIndex);
      }
    }

    for (const part of parts) {
      const weight = Math.max(1, Math.round(part.veterinarians || 1));

      const satisfiesSeparation = (dayIndex: number) =>
        occupiedDayIndices.every(
          (occupied) => daysBetweenDates(availableDays[dayIndex].date, availableDays[occupied].date) >= minDaysBetweenSplitVisits,
        );

      // 1a tentativa: respeita separacao E o teto diario.
      let bestDayIndex = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let dayIndex = 0; dayIndex < availableDays.length; dayIndex += 1) {
        if (!satisfiesSeparation(dayIndex)) continue;
        const slot = args.clusterOrder[dayIndex];
        if (slot === undefined) continue;
        if (loadOfSlot(slot) + weight > maxPerDay) continue;
        const cost = squaredDistance(args.project(part), args.centroids[slot]);
        if (cost < bestCost) {
          bestCost = cost;
          bestDayIndex = dayIndex;
        }
      }

      // 2a tentativa: relaxa o teto diario — a separacao entre partes e regra
      // de negocio explicita e pesa mais que o limite diario nesse caso raro.
      if (bestDayIndex === -1) {
        for (let dayIndex = 0; dayIndex < availableDays.length; dayIndex += 1) {
          if (!satisfiesSeparation(dayIndex)) continue;
          const slot = args.clusterOrder[dayIndex];
          if (slot === undefined) continue;
          const cost = squaredDistance(args.project(part), args.centroids[slot]);
          if (cost < bestCost) {
            bestCost = cost;
            bestDayIndex = dayIndex;
          }
        }
      }

      if (bestDayIndex === -1) {
        // O mes nao tem dias suficientes espalhados para separar as partes.
        // Coloca no dia mais distante das ocupacoes atuais, e avisa — nunca
        // descarta a visita silenciosamente.
        let fallbackDayIndex = 0;
        let fallbackSeparation = -1;
        for (let dayIndex = 0; dayIndex < availableDays.length; dayIndex += 1) {
          const minSeparation = occupiedDayIndices.length
            ? Math.min(
                ...occupiedDayIndices.map((occupied) =>
                  daysBetweenDates(availableDays[dayIndex].date, availableDays[occupied].date),
                ),
              )
            : Number.POSITIVE_INFINITY;
          if (minSeparation > fallbackSeparation) {
            fallbackSeparation = minSeparation;
            fallbackDayIndex = dayIndex;
          }
        }
        bestDayIndex = fallbackDayIndex;
        warnings.push({
          groupId,
          message: `O mês não tem dias suficientes para respeitar ${minDaysBetweenSplitVisits} dia(s) entre as partes de "${part.name.replace(/\s*\(parte.*\)$/, '')}". A separação obtida foi de ${Math.round(fallbackSeparation)} dia(s).`,
        });
      }

      const slot = args.clusterOrder[bestDayIndex];
      const pointIndex = points.length;
      points.push({ id: part.id, lat: part.lat, lng: part.lng });
      weights.push(weight);
      clusters[slot].push(pointIndex);
      pointDayIndex.set(pointIndex, bestDayIndex);
      occupiedDayIndices.push(bestDayIndex);
    }
  }

  return { clusters, points, weights, warnings };
}

function squaredDistance(point: [number, number], centroid: [number, number]): number {
  const dx = point[0] - centroid[0];
  const dy = point[1] - centroid[1];
  return dx * dx + dy * dy;
}
