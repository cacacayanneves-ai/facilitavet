import { describe, expect, it } from 'vitest';
import { describeVisitFrequency, parseFixedDate, parseVisitFrequency } from '@/lib/services/visit-frequency';

/**
 * A coluna de frequencia da planilha real e texto livre, com erros de
 * digitacao. Cada caso abaixo e um valor que existe na planilha do cliente.
 */
describe('frequencia de visita (texto livre da planilha)', () => {
  const cases: Array<[string, Partial<ReturnType<typeof parseVisitFrequency>>]> = [
    ['1x no mês', { visits: 1, allowedWeekdays: [], preferredWeekdays: [] }],
    ['2x no mês em dias alternados', { visits: 2, allowedWeekdays: [] }],
    ['1x no mês terça ou quinta', { visits: 1, allowedWeekdays: [2, 4] }],
    ['1x no mês sempre sexta', { visits: 1, allowedWeekdays: [5] }],
    ['1x no mês sempre as sextas', { visits: 1, allowedWeekdays: [5] }],
    ['2x no mês em dias alternados, um dia na quinta', { visits: 2, allowedWeekdays: [], oneVisitWeekday: 4 }],
    ['1x no mês de preferencia quarta feira mas nao é algo obrigatório', { visits: 1, allowedWeekdays: [], preferredWeekdays: [3] }],
    ['1x no mês de prefencia terça', { visits: 1, preferredWeekdays: [2] }],
    ['1x no mês evitar as sextas', { visits: 1, allowedWeekdays: [0, 1, 2, 3, 4, 6] }],
  ];

  it.each(cases)('%s', (text, expected) => {
    expect(parseVisitFrequency(text)).toMatchObject(expected);
  });

  it('vazio ou 0x = fora do mes', () => {
    expect(parseVisitFrequency('').visits).toBe(0);
    expect(parseVisitFrequency(null).visits).toBe(0);
    expect(parseVisitFrequency('0x').visits).toBe(0);
  });

  it('resumo curto para a tela', () => {
    expect(describeVisitFrequency(parseVisitFrequency('2x no mês em dias alternados, um dia na quinta'))).toBe('2x · uma na qui');
    expect(describeVisitFrequency(parseVisitFrequency('1x no mês evitar as sextas'))).toBe('1x · sem sex');
  });
});

describe('data marcada', () => {
  const reference = new Date('2026-10-03T12:00:00Z');

  it('le "colocar dia 16 de outubro", inclusive com erro de digitacao', () => {
    expect(parseFixedDate('colocar dia 16 de outubro', reference)).toBe('2026-10-16');
    expect(parseFixedDate('colocar deia 16 de outubro', reference)).toBe('2026-10-16');
    expect(parseFixedDate('16/10', reference)).toBe('2026-10-16');
  });

  it('data de um mes que ja passou ha tempo vai para o ano seguinte', () => {
    expect(parseFixedDate('dia 5/1', reference)).toBe('2027-01-05');
  });

  it('ignora o que nao e data ("SET OK", numeros soltos, dia invalido)', () => {
    expect(parseFixedDate('SET OK', reference)).toBeNull();
    expect(parseFixedDate('80.0', reference)).toBeNull();
    expect(parseFixedDate('31 de fevereiro', reference)).toBeNull();
  });
});
