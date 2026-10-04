import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, selectClinicsForMonth, type PlannerClinic } from '@/lib/route-planner';

/**
 * Ciclo comercial real (explicado pela propagandista): 2 meses, 160 visitas
 * por mes contando VETERINARIOS. Mes 1 = 80 Cat 1 + 80 Cat 2; mes 2 = 80
 * Cat 1 + Cat 3, com minimo de 40 Cat 3 e o restante podendo vir da Cat 2.
 * Ancora padrao: jan/2026 comeca com Cat 2 -> setembro = Cat 2, outubro = Cat 3.
 */
function vets(prefix: string, category: PlannerClinic['category'], count: number, extra: Partial<PlannerClinic> = {}) {
  return Array.from({ length: count }, (_, i): PlannerClinic => ({
    id: `${prefix}${i}`,
    name: `${prefix}${i}`,
    category,
    veterinarians: 2,
    lat: -22.9,
    lng: -43.5,
    ...extra,
  }));
}

const select = (clinics: PlannerClinic[], month: number) =>
  selectClinicsForMonth(clinics, DEFAULT_CATEGORY_RULES, 2026, month, 160, new Date('2026-10-01T12:00:00Z'));

describe('ciclo de 2 meses, 160 visitas por mes', () => {
  const carteira = [...vets('a', 'CAT1', 45), ...vets('b', 'CAT2', 45), ...vets('c', 'CAT3', 30)];

  it('mes 1 (setembro): 80 Cat 1 + 80 Cat 2', () => {
    const result = select(carteira, 9);
    expect(result.requiredCategories).toEqual(['CAT1', 'CAT2']);
    expect(result.perCategory).toEqual({ CAT1: 80, CAT2: 80, CAT3: 0 });
    expect(result.totalVisits).toBe(160);
  });

  it('mes 2 (outubro): Cat 3 com 60 e a Cat 2 completa ate 160, com aviso', () => {
    const result = select(carteira, 10);
    expect(result.requiredCategories).toEqual(['CAT1', 'CAT3']);
    expect(result.perCategory).toEqual({ CAT1: 80, CAT2: 20, CAT3: 60 });
    expect(result.totalVisits).toBe(160);
    expect(result.warnings.some((w) => w.code === 'CATEGORY_COMPLEMENT')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'CATEGORY_BELOW_MINIMUM')).toBe(false);
  });

  it('Cat 3 abaixo do minimo de 40 avisa', () => {
    const result = select([...vets('a', 'CAT1', 45), ...vets('b', 'CAT2', 45), ...vets('c', 'CAT3', 15)], 10);
    expect(result.perCategory.CAT3).toBe(30);
    expect(result.warnings.some((w) => w.code === 'CATEGORY_BELOW_MINIMUM')).toBe(true);
  });

  it('complemento prefere quem nao foi visitado no mes anterior', () => {
    const visitedInSeptember = vets('vb', 'CAT2', 20, { lastVisitedAt: new Date('2026-09-15T12:00:00Z') });
    const notVisited = vets('nb', 'CAT2', 10);
    const result = select([...vets('a', 'CAT1', 45), ...visitedInSeptember, ...notVisited, ...vets('c', 'CAT3', 30)], 10);
    const complement = result.selected.filter((c) => c.category === 'CAT2').map((c) => c.id);
    expect(complement).toHaveLength(10);
    expect(complement.every((id) => id.startsWith('nb'))).toBe(true);
  });

  it('data marcada no mes entra mesmo fora do ciclo; frequencia vazia nunca entra', () => {
    const result = select(
      [
        ...carteira,
        { ...vets('marcada', 'CAT2', 1)[0], fixedDate: '2026-10-16' },
        { ...vets('online', 'CAT3', 1)[0], monthlyVisits: 0 },
      ],
      10,
    );
    const ids = result.selected.map((c) => c.id);
    expect(ids).toContain('marcada0');
    expect(ids).not.toContain('online0');
  });
});
