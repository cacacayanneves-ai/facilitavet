import { describe, expect, it } from 'vitest';
import { currentYearMonth, greeting, todayKey, zonedDateTimeToUtc } from '@/lib/utils';

/**
 * O servidor roda em UTC (3h a frente de Brasilia). "Hoje", o mes corrente e
 * a saudacao precisam seguir o relogio do Brasil — senao, a partir das 21h,
 * o painel "Hoje" mostra a rota de amanha.
 */
describe('fuso do negocio (America/Sao_Paulo)', () => {
  it('21h30 de Brasilia ainda e hoje, mesmo ja sendo amanha em UTC', () => {
    const now = new Date('2026-09-15T00:30:00Z'); // 14/09 21:30 em Brasilia
    expect(todayKey(now)).toBe('2026-09-14');
  });

  it('no ultimo dia do mes a noite, o mes corrente nao pula para o seguinte', () => {
    const now = new Date('2026-10-01T01:00:00Z'); // 30/09 22:00 em Brasilia
    expect(currentYearMonth(now)).toEqual({ year: 2026, month: 9 });
  });

  it('horario configurado vira o instante real certo', () => {
    expect(zonedDateTimeToUtc('2026-09-14', '08:00').toISOString()).toBe('2026-09-14T11:00:00.000Z');
    expect(zonedDateTimeToUtc('2026-09-14', '00:00').toISOString()).toBe('2026-09-14T03:00:00.000Z');
  });

  it('saudacao segue a hora de Brasilia', () => {
    expect(greeting(new Date('2026-09-14T12:00:00Z'))).toBe('Bom dia'); // 09h
    expect(greeting(new Date('2026-09-14T18:00:00Z'))).toBe('Boa tarde'); // 15h
    expect(greeting(new Date('2026-09-14T22:00:00Z'))).toBe('Boa noite'); // 19h
  });
});
