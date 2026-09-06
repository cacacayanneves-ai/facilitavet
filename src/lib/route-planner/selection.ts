import { requiredCategoriesFor } from './category-cycle';
import type { CategoryCode, CategoryRuleSet, PlannerClinic, PlannerWarning } from './types';

export interface SelectionResult {
  selected: PlannerClinic[];
  requiredCategories: CategoryCode[];
  perCategory: Record<CategoryCode, number>;
  skippedNoCoordinates: string[];
  warnings: PlannerWarning[];
}

/**
 * Etapa 1-3 do motor: quem entra no mes.
 *
 * A selecao respeita, nesta ordem:
 *  1. as categorias exigidas pelo ciclo do mes;
 *  2. o targetCount de cada categoria;
 *  3. a meta mensal total do usuario;
 *  4. desempate por "ha mais tempo sem visita" e prioridade comercial.
 *
 * Quando a meta e MENOR que a soma dos targets das categorias, cortamos de
 * forma proporcional (nao truncando uma categoria inteira) para nao zerar Cat 2
 * so porque Cat 1 e maior.
 */
export function selectClinicsForMonth(
  clinics: PlannerClinic[],
  rules: CategoryRuleSet,
  year: number,
  month: number,
  monthlyTarget: number,
  referenceDate: Date,
): SelectionResult {
  const warnings: PlannerWarning[] = [];
  const requiredCategories = requiredCategoriesFor(rules, year, month);

  const eligible = clinics.filter((c) => requiredCategories.includes(c.category));

  const withCoords = eligible.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const skippedNoCoordinates = eligible
    .filter((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lng))
    .map((c) => c.id);

  if (skippedNoCoordinates.length > 0) {
    warnings.push({
      code: 'MISSING_COORDINATES',
      message: `${skippedNoCoordinates.length} clinica(s) da categoria do mes estao sem localizacao e ficaram de fora do roteiro.`,
      details: { clinicIds: skippedNoCoordinates },
    });
  }

  // Quotas por categoria: min(targetCount configurado, disponivel na carteira)
  const byCategory = new Map<CategoryCode, PlannerClinic[]>();
  for (const category of requiredCategories) {
    const pool = withCoords
      .filter((c) => c.category === category)
      .sort(comparePriority(referenceDate));
    byCategory.set(category, pool);
  }

  const quotas = new Map<CategoryCode, number>();
  for (const category of requiredCategories) {
    const configured = rules.rules[category]?.targetCount ?? 0;
    const available = byCategory.get(category)?.length ?? 0;
    quotas.set(category, Math.min(configured, available));
  }

  let totalQuota = sum([...quotas.values()]);

  if (totalQuota > monthlyTarget) {
    // Corte proporcional para caber na meta mensal.
    scaleQuotasDown(quotas, requiredCategories, monthlyTarget);
    totalQuota = sum([...quotas.values()]);
  } else if (totalQuota < monthlyTarget) {
    // Sobra de meta: completa com o que existir de excedente nas categorias do mes.
    let remaining = monthlyTarget - totalQuota;
    for (const category of requiredCategories) {
      if (remaining <= 0) break;
      const available = byCategory.get(category)?.length ?? 0;
      const current = quotas.get(category) ?? 0;
      const extra = Math.min(remaining, available - current);
      if (extra > 0) {
        quotas.set(category, current + extra);
        remaining -= extra;
      }
    }
    if (remaining > 0) {
      warnings.push({
        code: 'TARGET_ABOVE_POOL',
        message: `A meta de ${monthlyTarget} visitas e maior que a carteira disponivel para ${requiredCategories.join(' + ')}. O plano foi gerado com ${monthlyTarget - remaining} visitas.`,
        details: { requested: monthlyTarget, available: monthlyTarget - remaining },
      });
    }
  }

  const selected: PlannerClinic[] = [];
  const perCategory: Record<CategoryCode, number> = { CAT1: 0, CAT2: 0, CAT3: 0 };

  for (const category of requiredCategories) {
    const quota = quotas.get(category) ?? 0;
    const pool = byCategory.get(category) ?? [];
    const picked = pool.slice(0, quota);
    selected.push(...picked);
    perCategory[category] = picked.length;
  }

  return { selected, requiredCategories, perCategory, skippedNoCoordinates, warnings };
}

/**
 * Ordena por urgencia comercial: primeiro quem esta ha mais tempo sem visita,
 * depois prioridade explicita, depois nome (estabilidade).
 */
function comparePriority(referenceDate: Date) {
  return (a: PlannerClinic, b: PlannerClinic) => {
    const aDays = daysSinceVisit(a.lastVisitedAt, referenceDate);
    const bDays = daysSinceVisit(b.lastVisitedAt, referenceDate);
    if (aDays !== bDays) return bDays - aDays;
    const aPriority = a.priority ?? 0;
    const bPriority = b.priority ?? 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return a.name.localeCompare(b.name, 'pt-BR');
  };
}

function daysSinceVisit(last: Date | null | undefined, reference: Date): number {
  if (!last) return Number.MAX_SAFE_INTEGER / 2;
  return Math.floor((reference.getTime() - last.getTime()) / 86_400_000);
}

function scaleQuotasDown(
  quotas: Map<CategoryCode, number>,
  categories: CategoryCode[],
  target: number,
): void {
  const total = sum([...quotas.values()]);
  if (total <= target) return;

  const scaled = categories.map((category) => {
    const raw = ((quotas.get(category) ?? 0) * target) / total;
    return { category, floor: Math.floor(raw), remainder: raw - Math.floor(raw) };
  });

  let assigned = sum(scaled.map((s) => s.floor));
  scaled.sort((a, b) => b.remainder - a.remainder);
  let i = 0;
  while (assigned < target && scaled.length > 0) {
    const entry = scaled[i % scaled.length];
    const cap = quotas.get(entry.category) ?? 0;
    if (entry.floor < cap) {
      entry.floor += 1;
      assigned += 1;
    }
    i += 1;
    if (i > target * 4) break;
  }

  for (const entry of scaled) quotas.set(entry.category, entry.floor);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
