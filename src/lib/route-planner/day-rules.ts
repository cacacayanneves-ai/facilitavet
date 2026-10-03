import { haversineMeters } from './geo';
import type { AvailableDay, LatLng, PlannerClinic } from './types';

/**
 * Regras de dia da planilha: "sempre sexta", "terça ou quinta", data marcada,
 * "um dia na quinta" (clinica dividida), "de preferencia quarta".
 *
 * O motor monta os dias por GEOGRAFIA (agrupamento) e so depois atribui cada
 * grupo a uma data. Restricao de dia nao cabe no agrupamento sem distorce-lo
 * inteiro por causa de meia duzia de clinicas — entao ela entra aqui, como
 * reparo: quem caiu num dia proibido vai para o dia permitido cuja regiao fica
 * mais perto dela. Dia cheio cede uma clinica SEM restricao para outro dia
 * com folga, em vez de estourar a capacidade.
 *
 * Ordem: data marcada e regras obrigatorias primeiro (das mais restritas para
 * as menos), depois "uma das visitas no dia X", e por ultimo a preferencia —
 * que so move quando o desvio geografico e pequeno.
 */

export interface DayRuleWarning {
  clinicId: string;
  message: string;
}

interface Args {
  clusters: number[][];
  clusterOrder: number[];
  pointIds: string[];
  weights: number[];
  clinicById: Map<string, PlannerClinic>;
  availableDays: AvailableDay[];
  maxPerDay: number;
  minPerDay: number;
  minDaysBetweenSplitVisits: number;
}

const WEEKDAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Quanto a preferencia pode afastar uma clinica da regiao do dia original. */
const PREFERENCE_MAX_DETOUR_METERS = 4_000;
/** Quanto um dia esvaziado pode puxar uma clinica de outra regiao. */
const FILL_MAX_DETOUR_METERS = 8_000;

export function applyDayRules(args: Args): { clusters: number[][]; warnings: DayRuleWarning[] } {
  const { clusterOrder, pointIds, weights, clinicById, availableDays, maxPerDay } = args;
  const warnings: DayRuleWarning[] = [];
  const dayCount = availableDays.length;

  const members: number[][] = availableDays.map((_, d) => [...(args.clusters[clusterOrder[d]] ?? [])]);
  // Dia sem grupo associado nao tem para onde gravar: nunca e destino.
  const hasCluster = (d: number) => clusterOrder[d] !== undefined;
  const dayOfPoint = new Map<number, number>();
  members.forEach((list, d) => list.forEach((p) => dayOfPoint.set(p, d)));

  const clinicOf = (p: number) => clinicById.get(pointIds[p]);
  const groupOf = (p: number) => clinicOf(p)?.splitOf ?? pointIds[p];
  const load = (d: number) => members[d].reduce((sum, p) => sum + weights[p], 0);
  const dateIndex = availableDays.map((day) => Date.parse(`${day.date}T00:00:00Z`) / 86_400_000);

  const centroidOf = (d: number, exclude?: number): LatLng | null => {
    const pts = members[d].filter((p) => p !== exclude).map((p) => clinicOf(p)).filter(Boolean) as PlannerClinic[];
    if (pts.length === 0) return null;
    return {
      lat: pts.reduce((s, c) => s + c.lat, 0) / pts.length,
      lng: pts.reduce((s, c) => s + c.lng, 0) / pts.length,
    };
  };
  // Regiao original de cada dia: um dia que se esvaziou (todas as clinicas
  // tinham regra de outro dia) continua "sendo" daquela regiao e pode
  // receber clinicas de la no reequilibrio.
  const originalCenter = availableDays.map((_, d) => centroidOf(d));
  // Dia sem regiao nenhuma: custo alto mas finito, para ser ultima opcao.
  const costOf = (p: number, d: number): number => {
    const clinic = clinicOf(p);
    const center = centroidOf(d, p) ?? originalCenter[d];
    if (!clinic || !center) return 50_000;
    return haversineMeters(clinic, center);
  };

  const fixedDayOf = new Map<string, number | null>();
  const resolveFixedDay = (clinic: PlannerClinic): number | null => {
    if (!clinic.fixedDate) return null;
    const key = clinic.splitOf ?? clinic.id;
    if (!fixedDayOf.has(key)) {
      const index = availableDays.findIndex((day) => day.date === clinic.fixedDate);
      fixedDayOf.set(key, index === -1 ? null : index);
      if (index === -1) {
        warnings.push({
          clinicId: key,
          message: `${baseName(clinic)}: a data marcada (${formatDate(clinic.fixedDate)}) não é um dia útil disponível do mês; a visita foi planejada pela região.`,
        });
      }
    }
    return fixedDayOf.get(key) ?? null;
  };

  /** Dias que a regra OBRIGATORIA desta parada aceita. */
  const allowedDays = (p: number, extraWeekday?: number): number[] => {
    const clinic = clinicOf(p);
    if (!clinic) return [];
    const fixed = resolveFixedDay(clinic);
    // Data marcada vale para a primeira parte; as demais seguem as outras regras.
    if (fixed !== null && (clinic.splitPart ?? 1) === 1) return hasCluster(fixed) ? [fixed] : [];
    const weekdays = clinic.allowedWeekdays ?? [];
    return availableDays
      .map((day, d) => ({ day, d }))
      .filter(({ day }) => weekdays.length === 0 || weekdays.includes(day.weekday))
      .filter(({ day }) => extraWeekday === undefined || day.weekday === extraWeekday)
      .filter(({ d }) => hasCluster(d))
      .map(({ d }) => d);
  };

  const separationOk = (p: number, d: number): boolean => {
    if (args.minDaysBetweenSplitVisits <= 0) return true;
    const group = groupOf(p);
    for (const [other, od] of dayOfPoint) {
      if (other === p || groupOf(other) !== group) continue;
      if (Math.abs(dateIndex[d] - dateIndex[od]) < args.minDaysBetweenSplitVisits) return false;
    }
    return true;
  };

  const isConstrained = (p: number): boolean => {
    const clinic = clinicOf(p);
    if (!clinic) return false;
    return Boolean(clinic.fixedDate) || (clinic.allowedWeekdays?.length ?? 0) > 0 || clinic.oneVisitWeekday != null;
  };
  const locked = new Set<number>();

  const move = (p: number, to: number) => {
    const from = dayOfPoint.get(p);
    if (from !== undefined) members[from] = members[from].filter((x) => x !== p);
    members[to].push(p);
    dayOfPoint.set(p, to);
  };

  /** Pode ser realocada livremente para equilibrar a agenda. */
  // Quem tem so preferencia de dia e ja esta fora dele nao perde nada ao
  // mudar; quem esta no dia preferido fica.
  const isFree = (q: number): boolean => {
    if (locked.has(q) || isConstrained(q)) return false;
    const preferred = clinicOf(q)?.preferredWeekdays ?? [];
    const day = dayOfPoint.get(q);
    return preferred.length === 0 || day === undefined || !preferred.includes(availableDays[day].weekday);
  };

  /** Tira de `d` a parada sem restricao que menos sofre ao mudar de dia. */
  const evictOne = (d: number): boolean => {
    let best: { q: number; to: number; extra: number } | null = null;
    for (const q of members[d]) {
      if (!isFree(q)) continue;
      const here = costOf(q, d);
      for (let to = 0; to < dayCount; to += 1) {
        if (to === d || !hasCluster(to)) continue;
        if (load(to) + weights[q] > maxPerDay) continue;
        if (!separationOk(q, to)) continue;
        const extra = costOf(q, to) - here;
        if (!best || extra < best.extra) best = { q, to, extra };
      }
    }
    if (!best) return false;
    move(best.q, best.to);
    return true;
  };

  /** Coloca `p` no melhor dia de `candidates`; devolve false se nenhum serviu. */
  const place = (p: number, candidates: number[]): boolean => {
    const ranked = candidates
      .filter((d) => separationOk(p, d))
      .sort((a, b) => costOf(p, a) - costOf(p, b));
    if (ranked.length === 0) return false;
    const current = dayOfPoint.get(p);
    const withRoom = ranked.find((d) => d === current || load(d) + weights[p] <= maxPerDay);
    if (withRoom !== undefined) {
      if (withRoom !== current) move(p, withRoom);
      return true;
    }
    // Todos cheios: libera espaco no mais proximo; se nao der, aceita o
    // excesso — a regra do dia vale mais que um veterinario a mais na agenda.
    const target = ranked[0];
    while (load(target) + weights[p] > maxPerDay && evictOne(target)) {
      // libera uma parada por vez ate caber
    }
    move(p, target);
    return true;
  };

  const allPoints = [...dayOfPoint.keys()];

  // 1) Data marcada e dias obrigatorios — os mais restritos primeiro.
  const hard = allPoints
    .filter((p) => {
      const c = clinicOf(p);
      return c && (c.fixedDate || (c.allowedWeekdays?.length ?? 0) > 0);
    })
    .map((p) => ({ p, options: allowedDays(p) }))
    .sort((a, b) => a.options.length - b.options.length);

  for (const { p, options } of hard) {
    const clinic = clinicOf(p)!;
    locked.add(p);
    if (options.length === 0) {
      warnings.push({
        clinicId: clinic.splitOf ?? clinic.id,
        message: `${baseName(clinic)}: nenhum dia útil do mês atende a regra "${describeWeekdays(clinic.allowedWeekdays ?? [])}"; a visita ficou no dia da região.`,
      });
      continue;
    }
    if (options.includes(dayOfPoint.get(p)!)) continue;
    if (!place(p, options)) {
      warnings.push({
        clinicId: clinic.splitOf ?? clinic.id,
        message: `${baseName(clinic)}: não foi possível respeitar a regra de dia sem quebrar o intervalo entre as visitas.`,
      });
    }
  }

  // 2) "Um dia na quinta": pelo menos uma das partes nesse dia da semana.
  const groups = new Map<string, number[]>();
  for (const p of allPoints) {
    const c = clinicOf(p);
    if (c?.oneVisitWeekday == null) continue;
    const key = groupOf(p);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const parts of groups.values()) {
    const clinic = clinicOf(parts[0])!;
    const weekday = clinic.oneVisitWeekday!;
    if (parts.some((p) => availableDays[dayOfPoint.get(p)!].weekday === weekday)) {
      parts.forEach((p) => locked.add(p));
      continue;
    }
    const options = parts
      .flatMap((p) => allowedDays(p, weekday).filter((d) => separationOk(p, d)).map((d) => ({ p, d })))
      .sort((a, b) => costOf(a.p, a.d) - costOf(b.p, b.d));
    if (options.length === 0) {
      warnings.push({
        clinicId: clinic.splitOf ?? clinic.id,
        message: `${baseName(clinic)}: não foi possível colocar uma das visitas numa ${WEEKDAY_NAME[weekday]}.`,
      });
      continue;
    }
    place(options[0].p, [options[0].d]);
    parts.forEach((p) => locked.add(p));
  }

  // 3) Preferencia: so move para um dia preferido com folga e perto.
  for (const p of allPoints) {
    const clinic = clinicOf(p);
    const preferred = clinic?.preferredWeekdays ?? [];
    if (!clinic || preferred.length === 0 || locked.has(p)) continue;
    const current = dayOfPoint.get(p)!;
    if (preferred.includes(availableDays[current].weekday)) continue;
    const here = costOf(p, current);
    const best = allowedDays(p)
      .filter((d) => preferred.includes(availableDays[d].weekday))
      .filter((d) => load(d) + weights[p] <= maxPerDay && separationOk(p, d))
      .map((d) => ({ d, cost: costOf(p, d) }))
      .filter(({ cost }) => cost <= here + PREFERENCE_MAX_DETOUR_METERS)
      .sort((a, b) => a.cost - b.cost)[0];
    if (best) move(p, best.d);
  }

  // 4) Reequilibrio: mover clinicas com regra de dia esvazia o dia de onde
  // elas sairam. Dia abaixo do minimo puxa, de um dia com folga, a clinica
  // sem restricao que fica mais perto dele.
  for (let guard = 0; guard < dayCount * 4; guard += 1) {
    let moved = false;
    for (let d = 0; d < dayCount; d += 1) {
      if (!hasCluster(d) || load(d) >= args.minPerDay) continue;
      let best: { q: number; delta: number } | null = null;
      for (let e = 0; e < dayCount; e += 1) {
        if (e === d) continue;
        for (const q of members[e]) {
          if (!isFree(q)) continue;
          if (load(e) - weights[q] < args.minPerDay) continue;
          if (load(d) + weights[q] > maxPerDay || !separationOk(q, d)) continue;
          const toCost = costOf(q, d);
          if (toCost > FILL_MAX_DETOUR_METERS) continue;
          const delta = toCost - costOf(q, e);
          if (!best || delta < best.delta) best = { q, delta };
        }
      }
      if (best) {
        move(best.q, d);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const clusters = args.clusters.map((list) => [...list]);
  clusterOrder.forEach((clusterIndex, d) => {
    if (d < dayCount) clusters[clusterIndex] = members[d];
  });
  return { clusters, warnings };
}

function baseName(clinic: PlannerClinic): string {
  return clinic.name.replace(/ \(parte \d+\/\d+\)$/, '');
}

function describeWeekdays(days: number[]): string {
  return days.map((d) => WEEKDAY_NAME[d]).join(' ou ');
}

function formatDate(key: string): string {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}
