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

/** Visitas pedidas no mes pela frequencia; sem frequencia definida conta 1. */
function monthlyVisitsOf(clinic: PlannerClinic): number {
  return clinic.monthlyVisits ?? 1;
}

/**
 * Etapas 1-3 do motor: quem entra no mes.
 *
 * REGRA CENTRAL: a meta conta VISITAS POR VETERINARIO, e uma clinica e uma
 * unidade ATOMICA de peso `veterinarians`. Isso muda a natureza da selecao:
 * nao e "pegue as 80 primeiras clinicas", e "pegue clinicas ate somar 80
 * visitas" — um problema de empacotamento, nao de contagem.
 *
 * Ciclo comercial real (2 meses, 160 visitas/mes): mes 1 = 80 Cat 1 + 80
 * Cat 2; mes 2 = 80 Cat 1 + Cat 3, com minimo de 40 Cat 3 e o restante podendo
 * vir da Cat 2. A selecao respeita, nesta ordem:
 *  0. fora: clinica que a planilha tirou do mes (visita online, ausente da
 *     planilha) nunca entra;
 *  1. clinica com DATA MARCADA no mes entra sempre, qualquer categoria — e
 *     uma instrucao explicita, nao uma sugestao;
 *  2. as categorias exigidas pelo ciclo, cada uma ate a sua cota de VISITAS;
 *  3. faltando visitas para a meta do mes, completa com a outra categoria
 *     alternada (a Cat 3 menor que 80 e completada pela Cat 2);
 *  4. desempate por "ha mais tempo sem visita" e prioridade comercial — o que
 *     faz o complemento preferir quem NAO foi visitado no mes anterior e
 *     aumenta os veterinarios diferentes do ciclo.
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
  const complementCategories = rules.alternatingOrder.filter(
    (c) => rules.rules[c]?.enabled && !requiredCategories.includes(c),
  );

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const isForced = (c: PlannerClinic) => Boolean(c.fixedDate?.startsWith(monthPrefix));
  const hasCoords = (c: PlannerClinic) => Number.isFinite(c.lat) && Number.isFinite(c.lng);

  const inMonth = clinics.filter((c) => monthlyVisitsOf(c) > 0);
  const eligible = inMonth.filter((c) => requiredCategories.includes(c.category) || isForced(c));

  const skippedNoCoordinates = eligible.filter((c) => !hasCoords(c)).map((c) => c.id);
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

  const priority = comparePriority(referenceDate);
  const forced = eligible.filter((c) => isForced(c) && hasCoords(c));
  const forcedIds = new Set(forced.map((c) => c.id));
  const poolOf = (category: CategoryCode) =>
    inMonth.filter((c) => c.category === category && hasCoords(c) && !forcedIds.has(c.id)).sort(priority);

  const byCategory = new Map<CategoryCode, PlannerClinic[]>();
  for (const category of requiredCategories) byCategory.set(category, poolOf(category));

  // Cota de visitas por categoria: min(configurado, disponivel na carteira).
  const forcedVisitsOf = (category: CategoryCode) =>
    forced.filter((c) => c.category === category).reduce((s, c) => s + visitsOf(c), 0);
  const quotas = new Map<CategoryCode, number>();
  for (const category of requiredCategories) {
    const configured = rules.rules[category]?.targetCount ?? 0;
    const available =
      (byCategory.get(category) ?? []).reduce((s, c) => s + visitsOf(c), 0) + forcedVisitsOf(category);
    quotas.set(category, Math.min(configured, available));
  }
  if (sum([...quotas.values()]) > monthlyTarget) scaleQuotasDown(quotas, requiredCategories, monthlyTarget);

  const selected: PlannerClinic[] = [];
  const perCategory: Record<CategoryCode, number> = { CAT1: 0, CAT2: 0, CAT3: 0 };
  const perCategoryStops: Record<CategoryCode, number> = { CAT1: 0, CAT2: 0, CAT3: 0 };
  const take = (picked: PlannerClinic[]) => {
    for (const clinic of picked) {
      if (!selected.includes(clinic)) selected.push(clinic);
      perCategory[clinic.category] += visitsOf(clinic);
      perCategoryStops[clinic.category] += 1;
    }
  };
  take(forced);

  for (const category of requiredCategories) {
    const remaining = Math.max(0, (quotas.get(category) ?? 0) - forcedVisitsOf(category));
    const picked = fillToVisitQuota(byCategory.get(category) ?? [], remaining);
    take(picked.clinics);
  }

  const total = () => sum(Object.values(perCategory));
  const leftover = (category: CategoryCode) =>
    poolOf(category).filter((c) => !selected.includes(c));

  // Sobra de meta: primeiro o excedente da categoria ALTERNADA do mes (Cat 3
  // alem da cota)... A mensal (Cat 1) e fixa: a meta dela e o numero da
  // carteira de fixos, nao um teto a ser estourado para fechar o mes.
  const alternatingRequired = requiredCategories.filter((c) => rules.rules[c]?.frequency !== 'monthly');
  const monthlyRequired = requiredCategories.filter((c) => rules.rules[c]?.frequency === 'monthly');
  for (const category of alternatingRequired) {
    if (total() >= monthlyTarget) break;
    take(fillToVisitQuota(leftover(category), monthlyTarget - total()).clinics);
  }

  // ...depois a outra categoria alternada (ex.: Cat 3 com menos de 80)...
  for (const category of complementCategories) {
    if (total() >= monthlyTarget) break;
    const before = perCategory[category];
    take(fillToVisitQuota(leftover(category), monthlyTarget - total()).clinics);
    const added = perCategory[category] - before;
    if (added > 0) {
      warnings.push({
        code: 'CATEGORY_COMPLEMENT',
        message: `${added} visita(s) de ${label(category)} completaram a meta do mês (${requiredCategories.map(label).join(' + ')} não somavam ${monthlyTarget}).`,
        details: { category, visits: added },
      });
    }
  }

  // ...e so em ultimo caso mais visitas da categoria mensal.
  for (const category of monthlyRequired) {
    if (total() >= monthlyTarget) break;
    take(fillToVisitQuota(leftover(category), monthlyTarget - total()).clinics);
  }

  if (total() < monthlyTarget) {
    warnings.push({
      code: 'TARGET_ABOVE_POOL',
      message: `A meta de ${monthlyTarget} visitas é maior que a carteira disponível. O plano foi gerado com ${total()} visitas.`,
      details: { requested: monthlyTarget, available: total() },
    });
  }

  for (const category of requiredCategories) {
    const minimum = rules.rules[category]?.minCount;
    if (minimum !== undefined && perCategory[category] < minimum) {
      warnings.push({
        code: 'CATEGORY_BELOW_MINIMUM',
        message: `${label(category)} ficou com ${perCategory[category]} visita(s), abaixo do mínimo de ${minimum} do ciclo.`,
        details: { category, visits: perCategory[category], minimum },
      });
    }
  }

  return {
    selected,
    requiredCategories,
    perCategory,
    perCategoryStops,
    totalVisits: total(),
    skippedNoCoordinates,
    warnings,
  };
}

function label(category: CategoryCode): string {
  return category.replace('CAT', 'Cat ');
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
