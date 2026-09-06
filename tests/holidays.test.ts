import { describe, expect, it } from 'vitest';
import { brazilianHolidays, easterSunday } from '@/lib/services/holidays';

describe('feriados', () => {
  it('calcula a Pascoa corretamente', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(easterSunday(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
  });

  it('deriva os feriados moveis de 2026 a partir da Pascoa', () => {
    const byName = new Map(brazilianHolidays(2026).map((h) => [h.name, h.date]));
    expect(byName.get('Carnaval')).toBe('2026-02-17');
    expect(byName.get('Sexta-feira Santa')).toBe('2026-04-03');
    expect(byName.get('Corpus Christi')).toBe('2026-06-04');
  });

  it('inclui os feriados fixos nacionais', () => {
    const dates = brazilianHolidays(2026).map((h) => h.date);
    expect(dates).toContain('2026-09-07');
    expect(dates).toContain('2026-12-25');
    expect(dates).toContain('2026-11-20');
  });

  it('funciona para qualquer ano', () => {
    for (const year of [2024, 2030, 2035]) {
      expect(brazilianHolidays(year).length).toBeGreaterThanOrEqual(14);
    }
  });
});
