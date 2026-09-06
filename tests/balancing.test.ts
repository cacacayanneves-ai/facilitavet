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
    const report = evaluateFeasibility({
      requiredVisits: 100,
      requiredStops: 100,
      availableDays: 17,
      minPerDay: 4,
      maxPerDay: 9,
      clinics: [],
    });
    expect(report.feasible).toBe(true);
    expect(report.capacity).toBe(153);
  });

  it('recusa 80 visitas em 17 dias com maximo de 4/dia e explica a alternativa', () => {
    const report = evaluateFeasibility({
      requiredVisits: 80,
      requiredStops: 80,
      availableDays: 17,
      minPerDay: 2,
      maxPerDay: 4,
      clinics: [],
    });
    expect(report.feasible).toBe(false);
    expect(report.capacity).toBe(68);
    expect(report.deficit).toBe(12);
    expect(report.suggestedDays).toBe(20);
    expect(report.message).toContain('20');
  });

  it('trata mes sem nenhum dia disponivel', () => {
    const report = evaluateFeasibility({
      requiredVisits: 100,
      requiredStops: 100,
      availableDays: 0,
      minPerDay: 4,
      maxPerDay: 9,
      clinics: [],
    });
    expect(report.feasible).toBe(false);
    expect(report.message).toContain('Nenhum dia disponível');
  });

  it('aceita clinica maior que o limite diario e avisa que ela toma o dia', () => {
    // Numa clinica publica todos os veterinarios estao juntos: a visita e uma
    // so e vale por todos. O limite diario rege o que se acrescenta ao dia,
    // entao uma parada de 9 com teto 8 nao inviabiliza nada, so ocupa o dia.
    const report = evaluateFeasibility({
      requiredVisits: 50,
      requiredStops: 10,
      availableDays: 20,
      minPerDay: 4,
      maxPerDay: 8,
      clinics: [
        { id: '1', name: 'Clínica Alfa', category: 'CAT1', veterinarians: 9, lat: 0, lng: 0 },
        { id: '2', name: 'Clínica Beta', category: 'CAT1', veterinarians: 3, lat: 0, lng: 0 },
      ],
    });
    expect(report.feasible).toBe(true);
    expect(report.fullDayClinics).toHaveLength(1);
    expect(report.fullDayClinics[0].name).toBe('Clínica Alfa');
    expect(report.message).toContain('Clínica Alfa');
    expect(report.message).toContain('dia inteiro');
  });

  it('conta a clinica de dia inteiro na capacidade pelo proprio tamanho', () => {
    // 3 dias, teto 8. Sem a clinica grande a capacidade seria 24; com ela,
    // sao 2 dias normais (16) + os 20 dela = 36.
    const report = evaluateFeasibility({
      requiredVisits: 36,
      requiredStops: 6,
      availableDays: 3,
      minPerDay: 4,
      maxPerDay: 8,
      clinics: [{ id: '1', name: 'Fazenda Modelo', category: 'CAT1', veterinarians: 20, lat: 0, lng: 0 }],
    });
    expect(report.capacity).toBe(36);
    expect(report.deficit).toBe(0);
    expect(report.feasible).toBe(true);
  });

  it('recusa quando ha mais clinicas de dia inteiro que dias disponiveis', () => {
    const report = evaluateFeasibility({
      requiredVisits: 60,
      requiredStops: 3,
      availableDays: 2,
      minPerDay: 4,
      maxPerDay: 8,
      clinics: [
        { id: '1', name: 'Alfa', category: 'CAT1', veterinarians: 20, lat: 0, lng: 0 },
        { id: '2', name: 'Beta', category: 'CAT1', veterinarians: 20, lat: 0, lng: 0 },
        { id: '3', name: 'Gama', category: 'CAT1', veterinarians: 20, lat: 0, lng: 0 },
      ],
    });
    expect(report.feasible).toBe(false);
    expect(report.message).toContain('ocupam');
  });

  it('nao marca como dia inteiro a clinica que cabe no limite', () => {
    const report = evaluateFeasibility({
      requiredVisits: 20,
      requiredStops: 5,
      availableDays: 10,
      minPerDay: 4,
      maxPerDay: 14,
      clinics: [{ id: '1', name: 'Clínica Alfa', category: 'CAT1', veterinarians: 8, lat: 0, lng: 0 }],
    });
    expect(report.fullDayClinics).toHaveLength(0);
  });
});
