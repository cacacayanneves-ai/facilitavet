import { requiredCategoriesFor } from './category-cycle';
import type { CategoryCode, CategoryRuleSet, PlannerClinic, PlannerWarning } from './types';

export interface SelectionResult {
  selected: PlannerClinic[];
  requiredCategories: CategoryCode[];
  /** Visitas (veterinarios) por categoria. */
  perCategory: Record<CategoryCode, number>;
  /** Clinicas por categoria. */
  perCategoryStops: Record<CategoryCode, number>;
  /** Soma de veterinarios das clinicas selecionadas. */
  totalVisits: number;
  skippedNoCoordinates: string[];
  warnings: PlannerWarning[];
}

/** Peso de uma clinica: quantas visitas (veterinarios) ela contabiliza. Uma clinica e atomica — todo seu peso vai para um unico dia. */
export function visitWeightOf(clinic: PlannerClinic): number {
  return Math.max(1, Math.round(clinic.veterinarians || 1));
}
const visitsOf = visitWeightOf;

/**
 * Etapas 1-3 do motor: quem entra no mes.
 *
 * REGRA CENTRAL: a meta conta VISITAS POR VETERINARIO, e uma clinica e uma
 * unidade ATOMICA de peso `veterinarians`. Isso muda a natureza da selecao:
 * nao e "pegue as 80 primeiras clinicas", e "pegue clinicas ate somar 80
 * visitas" — um problema de empacotamento, nao de contagem.
 *
 * A selecao respeita, nesta ordem:
 *  1. as categorias exigidas pelo ciclo do mes;
 *  2. a cota de VISITAS de cada categoria;
 *  3. a meta mensal total de VISITAS;
 *  4. desempate por "ha mais tempo sem visita" e prioridade comercial.
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
    const lostVisits = eligible
      .filter((c) => skippedNoCoordinates.includes(c.id))
      .reduce((sum, c) => sum + visitsOf(c), 0);
    warnings.push({
      code: 'MISSING_COORDINATES',
      message: `${skippedNoCoordinates.length} clínica(s) da categoria do mês estão sem localização e ficaram de fora do roteiro (${lostVisits} visita(s) perdidas).`,
      details: { clinicIds: skippedNoCoordinates, lostVisits },
    });
  }

  const byCategory = new Map<CategoryCode, PlannerClinic[]>();
  for (const category of requiredCategories) {
    byCategory.set(
      category,
      withCoords.filter((c) => c.category === category).sort(comparePriority(referenceDate)),
    );
  }

  // Cota de visitas por categoria: min(configurado, disponivel na carteira).
  const quotas = new Map<CategoryCode, number>();
  for (const category of requiredCategories) {
    const configured = rules.rules[category]?.targetCount ?? 0;
    const available = (byCategory.get(category) ?? []).reduce((sum, c) => sum + visitsOf(c), 0);
    quotas.set(category, Math.min(configured, available));
  }

  let totalQuota = sum([...quotas.values()]);

  if (totalQuota > monthlyTarget) {
    scaleQuotasDown(quotas, requiredCategories, monthlyTarget);
    totalQuota = sum([...quotas.values()]);
  } else if (totalQuota < monthlyTarget) {
    // Sobra de meta: completa com o excedente das categorias do mes.
    let remaining = monthlyTarget - totalQuota;
    for (const category of requiredCategories) {
      if (remaining <= 0) break;
      const available = (byCategory.get(category) ?? []).reduce((s, c) => s + visitsOf(c), 0);
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
        message: `A meta de ${monthlyTarget} visitas é maior que a carteira disponível para ${requiredCategories.join(' + ')}. O plano foi gerado com ${monthlyTarget - remaining} visitas.`,
        details: { requested: monthlyTarget, available: monthlyTarget - remaining },
      });
    }
  }

  const selected: PlannerClinic[] = [];
  const perCategory: Record<CategoryCode, number> = { CAT1: 0, CAT2: 0, CAT3: 0 };
  const perCategoryStops: Record<CategoryCode, number> = { CAT1: 0, CAT2: 0, CAT3: 0 };

  for (const category of requiredCategories) {
    const picked = fillToVisitQuota(byCategory.get(category) ?? [], quotas.get(category) ?? 0);
    selected.push(...picked.clinics);
    perCategory[category] = picked.visits;
    perCategoryStops[category] = picked.clinics.length;
  }

  return {
    selected,
    requiredCategories,
    perCategory,
    perCategoryStops,
    totalVisits: sum(Object.values(perCategory)),
    skippedNoCoordinates,
    warnings,
  };
}

/**
 * Preenche uma cota de VISITAS escolhendo clinicas inteiras.
 *
 * Como as clinicas sao atomicas, quase nunca da para fechar a cota exata. A
 * estrategia e gulosa por prioridade e depois faz um ajuste fino: se sobrar
 * uma folga, procura na fila a clinica cujo tamanho melhor a preencha. Isso
 * evita o resultado ruim de parar em 74 visitas com meta 80 so porque a
 * proxima da fila tinha 8 veterinarios.
 */
function fillToVisitQuota(
  pool: PlannerClinic[],
  quota: number,
): { clinics: PlannerClinic[]; visits: number } {
  if (quota <= 0 || pool.length === 0) return { clinics: [], visits: 0 };

  const chosen: PlannerClinic[] = [];
  const remainingPool = [...pool];
  let visits = 0;

  // Fase 1 — guloso por prioridade, sem estourar a cota.
  for (let i = 0; i < remainingPool.length; i += 1) {
    const clinic = remainingPool[i];
    const weight = visitsOf(clinic);
    if (visits + weight <= quota) {
      chosen.push(clinic);
      visits += weight;
      remainingPool.splice(i, 1);
      i -= 1;
    }
    if (visits === quota) break;
  }

  // Fase 2 — fecha a folga com a clinica que couber melhor.
  let gap = quota - visits;
  let guard = 0;
  while (gap > 0 && remainingPool.length > 0 && guard < pool.length) {
    guard += 1;
    let bestIndex = -1;
    let bestFit = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remainingPool.length; i += 1) {
      const weight = visitsOf(remainingPool[i]);
      if (weight > gap) continue;
      const fit = gap - weight; // 0 = encaixe perfeito
      if (fit < bestFit) {
        bestFit = fit;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) break;
    const [clinic] = remainingPool.splice(bestIndex, 1);
    chosen.push(clinic);
    visits += visitsOf(clinic);
    gap = quota - visits;
  }

  return { clinics: chosen, visits };
}

/** Ordena por urgencia comercial: mais tempo sem visita, depois prioridade. */
function comparePriority(referenceDate: Date) {
  return (a: PlannerClinic, b: PlannerClinic) => {
    const aDays = daysSinceVisit(a.lastVisitedAt, referenceDate);
    const bDays = daysSinceVisit(b.lastVisitedAt, referenceDate);
    if (aDays !== bDays) return bDays - aDays;
    const aPriority = a.priority ?? 0;
    const bPriority = b.priority ?? 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    // Clinicas maiores primeiro: entregam mais visitas por deslocamento.
    const aVisits = visitsOf(a);
    const bVisits = visitsOf(b);
    if (aVisits !== bVisits) return bVisits - aVisits;
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
    if (entry.floor < (quotas.get(entry.category) ?? 0)) {
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
