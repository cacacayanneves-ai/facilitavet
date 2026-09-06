import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORY_RULES,
  categoryForecast,
  findCategoryOverlaps,
  requiredCategoriesFor,
} from '@/lib/route-planner';
import type { CategoryRuleSet } from '@/lib/route-planner';

const rules: CategoryRuleSet = {
  ...DEFAULT_CATEGORY_RULES,
  anchorMonth: 1,
  anchorYear: 2026,
};

describe('ciclo de categorias', () => {
  it('exige Cat 1 em todos os meses', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(requiredCategoriesFor(rules, 2026, month)).toContain('CAT1');
    }
  });

  it('alterna Cat 2 e Cat 3 mes sim, mes nao', () => {
    expect(requiredCategoriesFor(rules, 2026, 1)).toEqual(['CAT1', 'CAT2']);
    expect(requiredCategoriesFor(rules, 2026, 2)).toEqual(['CAT1', 'CAT3']);
    expect(requiredCategoriesFor(rules, 2026, 3)).toEqual(['CAT1', 'CAT2']);
    expect(requiredCategoriesFor(rules, 2026, 4)).toEqual(['CAT1', 'CAT3']);
  });

  it('nunca exige Cat 2 e Cat 3 no mesmo mes', () => {
    for (let month = 1; month <= 12; month += 1) {
      const categories = requiredCategoriesFor(rules, 2026, month);
      expect(categories.includes('CAT2') && categories.includes('CAT3')).toBe(false);
    }
  });

  it('atravessa a virada de ano mantendo o rodizio', () => {
    expect(requiredCategoriesFor(rules, 2026, 12)).toEqual(['CAT1', 'CAT3']);
    expect(requiredCategoriesFor(rules, 2027, 1)).toEqual(['CAT1', 'CAT2']);
  });

  it('funciona para meses anteriores a ancora (modulo negativo)', () => {
    expect(requiredCategoriesFor(rules, 2025, 12)).toEqual(['CAT1', 'CAT3']);
    expect(requiredCategoriesFor(rules, 2025, 11)).toEqual(['CAT1', 'CAT2']);
  });

  it('respeita ancora configuravel: o sistema pode comecar em qualquer mes', () => {
    const custom: CategoryRuleSet = { ...rules, anchorMonth: 9, anchorYear: 2026, alternatingOrder: ['CAT3', 'CAT2'] };
    expect(requiredCategoriesFor(custom, 2026, 9)).toEqual(['CAT1', 'CAT3']);
    expect(requiredCategoriesFor(custom, 2026, 10)).toEqual(['CAT1', 'CAT2']);
  });

  it('projeta os proximos meses', () => {
    const forecast = categoryForecast(rules, 2026, 11, 3);
    expect(forecast.map((f) => f.month)).toEqual([11, 12, 1]);
    expect(forecast[2].year).toBe(2027);
  });
});

describe('exclusividade entre categorias', () => {
  it('nao acusa conflito quando cada clinica tem uma unica categoria', () => {
    const overlaps = findCategoryOverlaps([
      { id: '1', name: 'Clinica Alfa', neighborhood: 'Moema', category: 'CAT1' },
      { id: '2', name: 'Clinica Beta', neighborhood: 'Moema', category: 'CAT2' },
    ]);
    expect(overlaps).toHaveLength(0);
  });

  it('detecta a mesma clinica cadastrada em duas categorias', () => {
    const overlaps = findCategoryOverlaps([
      { id: '1', name: 'Clinica Alfa', neighborhood: 'Moema', category: 'CAT1' },
      { id: '2', name: 'CLINICA  ALFA', neighborhood: 'moema', category: 'CAT3' },
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].categories.sort()).toEqual(['CAT1', 'CAT3']);
  });
});

describe('adequacao das alternativas de troca', () => {
  /**
   * Regressao: "Trocar visita" chegou a sugerir clinicas Cat 3 num mes de
   * Cat 1 + Cat 2. Alternativa PROXIMA nao basta — ela precisa ser ADEQUADA ao
   * ciclo comercial do mes, senao a troca fura a regra que o motor respeitou.
   */
  it('so aceita categorias exigidas pelo mes', () => {
    const setembro = requiredCategoriesFor(rules, 2026, 9);
    const outubro = requiredCategoriesFor(rules, 2026, 10);

    expect(setembro).toEqual(['CAT1', 'CAT2']);
    expect(setembro).not.toContain('CAT3');
    expect(outubro).toEqual(['CAT1', 'CAT3']);
    expect(outubro).not.toContain('CAT2');

    const carteira = [
      { id: '1', category: 'CAT1' as const },
      { id: '2', category: 'CAT2' as const },
      { id: '3', category: 'CAT3' as const },
    ];
    const elegiveisSetembro = carteira.filter((c) => setembro.includes(c.category));
    expect(elegiveisSetembro.map((c) => c.id)).toEqual(['1', '2']);
  });
});
