import type { CategoryCode, CategoryRuleSet } from './types';

/**
 * Ciclo de categorias.
 *
 * REGRA DE PRODUTO (secao 14/71 do briefing): Cat 1 e mensal; Cat 2 e Cat 3
 * alternam mes sim / mes nao. Isso NAO pode virar `if (month === 1) return CAT2`.
 * O ciclo e ancorado em um mes de referencia e derivado por aritmetica de
 * meses absolutos, para que o sistema possa comecar em qualquer mes/ano e o
 * administrador possa mudar a ordem, a ancora ou a quantidade de categorias
 * alternadas sem tocar em codigo.
 */

export function absoluteMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** Posicao do mes dentro do rodizio de categorias alternadas. */
export function alternatingCycleIndex(rules: CategoryRuleSet, year: number, month: number): number {
  const order = rules.alternatingOrder.filter((c) => rules.rules[c]?.enabled);
  if (order.length === 0) return 0;
  const delta =
    absoluteMonthIndex(year, month) - absoluteMonthIndex(rules.anchorYear, rules.anchorMonth);
  // Modulo que se comporta corretamente para meses anteriores a ancora.
  return ((delta % order.length) + order.length) % order.length;
}

/** Categorias exigidas em um mes especifico. */
export function requiredCategoriesFor(
  rules: CategoryRuleSet,
  year: number,
  month: number,
): CategoryCode[] {
  const result: CategoryCode[] = [];

  for (const code of Object.keys(rules.rules) as CategoryCode[]) {
    const rule = rules.rules[code];
    if (!rule?.enabled) continue;
    if (rule.frequency === 'monthly') result.push(code);
  }

  const order = rules.alternatingOrder.filter((c) => rules.rules[c]?.enabled);
  if (order.length > 0) {
    const idx = alternatingCycleIndex(rules, year, month);
    result.push(order[idx]);
  }

  // Ordem estavel CAT1, CAT2, CAT3 para exibicao previsivel.
  const rank: Record<CategoryCode, number> = { CAT1: 0, CAT2: 1, CAT3: 2 };
  return [...new Set(result)].sort((a, b) => rank[a] - rank[b]);
}

/** Previsao dos proximos N meses — usada na tela de planejamento. */
export function categoryForecast(
  rules: CategoryRuleSet,
  year: number,
  month: number,
  months = 6,
): Array<{ year: number; month: number; categories: CategoryCode[] }> {
  const out: Array<{ year: number; month: number; categories: CategoryCode[] }> = [];
  for (let i = 0; i < months; i += 1) {
    const abs = absoluteMonthIndex(year, month) + i;
    const y = Math.floor(abs / 12);
    const m = (abs % 12) + 1;
    out.push({ year: y, month: m, categories: requiredCategoriesFor(rules, y, m) });
  }
  return out;
}

/**
 * Valida a exclusividade entre categorias (secao 15).
 *
 * O schema ja garante uma unica categoria por registro de clinica, mas a
 * carteira pode conter a MESMA clinica cadastrada duas vezes com categorias
 * diferentes (tipico de importacao de planilha). Isso e o que precisamos pegar.
 */
export function findCategoryOverlaps(
  clinics: Array<{ id: string; name: string; neighborhood?: string | null; category: CategoryCode }>,
): Array<{ key: string; name: string; categories: CategoryCode[]; clinicIds: string[] }> {
  const buckets = new Map<string, { name: string; entries: Array<{ id: string; category: CategoryCode }> }>();

  for (const clinic of clinics) {
    const key = `${normalizeKey(clinic.name)}|${normalizeKey(clinic.neighborhood ?? '')}`;
    const bucket = buckets.get(key) ?? { name: clinic.name, entries: [] };
    bucket.entries.push({ id: clinic.id, category: clinic.category });
    buckets.set(key, bucket);
  }

  const overlaps: Array<{ key: string; name: string; categories: CategoryCode[]; clinicIds: string[] }> = [];
  for (const [key, bucket] of buckets) {
    const categories = [...new Set(bucket.entries.map((e) => e.category))];
    if (categories.length > 1) {
      overlaps.push({
        key,
        name: bucket.name,
        categories,
        clinicIds: bucket.entries.map((e) => e.id),
      });
    }
  }
  return overlaps;
}

export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
