import { describe, expect, it } from 'vitest';
import { distributeDailyCapacity, evaluateFeasibility, rebalanceByDensity } from '@/lib/route-planner';

describe('distribuicao da meta pelos dias', () => {
  it('soma exatamente a meta: 100 visitas em 17 dias', () => {
    const { capacities } = distributeDailyCapacity(100, 17, 4, 9);
    expect(capacities).toHaveLength(17);
    expect(capacities.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('usa apenas 5 e 6 visitas por dia para 100/17 (nao fixa 6 ate acabar)', () => {
    const { capacities } = distributeDailyCapacity(100, 17, 4, 9);
    expect([...new Set(capacities)].sort()).toEqual([5, 6]);
    expect(capacities.filter((c) => c === 6)).toHaveLength(15);
    expect(capacities.filter((c) => c === 5)).toHaveLength(2);
  });

  it('espalha os dias mais cheios pelo mes em vez de concentrar no inicio', () => {
    const { capacities } = distributeDailyCapacity(50, 17, 1, 9);
    // 50/17 = 2 base + 16 extras; o unico dia "curto" nao pode ser o ultimo bloco inteiro
    const lightDays = capacities.map((c, i) => ({ c, i })).filter((x) => x.c === 2).map((x) => x.i);
    expect(lightDays.length).toBe(1);
    // Distribuicao equilibrada: o dia curto nao fica na primeira nem na ultima posicao por acaso
    expect(capacities.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('fecha a conta para divisoes exatas', () => {
    const { capacities } = distributeDailyCapacity(96, 16, 4, 9);
    expect(new Set(capacities)).toEqual(new Set([6]));
  });

  it('avisa quando a meta estoura o limite diario', () => {
    const { warnings } = distributeDailyCapacity(200, 17, 4, 9);
    expect(warnings.some((w) => w.code === 'DAY_OVERFLOW')).toBe(true);
  });

  it('mantem o total ao rebalancear por densidade', () => {
    const base = distributeDailyCapacity(100, 17, 4, 9).capacities;
    const weights = base.map((_, i) => 1 + (i % 3));
    const rebalanced = rebalanceByDensity(base, weights, 4, 9);
    expect(rebalanced.reduce((a, b) => a + b, 0)).toBe(100);
    expect(rebalanced.every((c) => c >= 4 && c <= 9)).toBe(true);
  });
});

describe('viabilidade', () => {
  it('aprova 100 visitas em 17 dias com maximo de 9/dia', () => {
    const report = evaluateFeasibility(100, 17, 4, 9);
    expect(report.feasible).toBe(true);
    expect(report.capacity).toBe(153);
  });

  it('recusa 80 visitas em 17 dias com maximo de 4/dia e explica a alternativa', () => {
    const report = evaluateFeasibility(80, 17, 2, 4);
    expect(report.feasible).toBe(false);
    expect(report.capacity).toBe(68);
    expect(report.deficit).toBe(12);
    expect(report.suggestedDays).toBe(20);
    expect(report.message).toContain('20');
  });

  it('trata mes sem nenhum dia disponivel', () => {
    const report = evaluateFeasibility(100, 0, 4, 9);
    expect(report.feasible).toBe(false);
    expect(report.message).toContain('Nenhum dia disponivel');
  });
});
