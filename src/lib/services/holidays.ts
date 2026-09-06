/**
 * Feriados nacionais brasileiros (secao 17).
 *
 * Calculados, nao tabelados: os feriados moveis dependem da Pascoa, entao uma
 * tabela fixa expiraria. O algoritmo de Meeus/Jones/Butcher da a Pascoa para
 * qualquer ano, e os demais sao deslocamentos a partir dela.
 *
 * Feriados estaduais e municipais entram como registros da organizacao no
 * banco (Holiday.state / Holiday.city), e o usuario pode bloquear qualquer dia
 * manualmente.
 */

export interface HolidayEntry {
  date: string;
  name: string;
  country: string;
  /** "" = nacional. */
  state?: string;
  city?: string;
}

/** Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function key(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function brazilianHolidays(year: number): HolidayEntry[] {
  const easter = easterSunday(year);

  const fixed: Array<[number, number, string]> = [
    [1, 1, 'Confraternização Universal'],
    [4, 21, 'Tiradentes'],
    [5, 1, 'Dia do Trabalho'],
    [9, 7, 'Independência do Brasil'],
    [10, 12, 'Nossa Senhora Aparecida'],
    [11, 2, 'Finados'],
    [11, 15, 'Proclamação da República'],
    [11, 20, 'Dia Nacional de Zumbi e da Consciencia Negra'],
    [12, 25, 'Natal'],
  ];

  const entries: HolidayEntry[] = fixed.map(([month, day, name]) => ({
    date: key(new Date(Date.UTC(year, month - 1, day))),
    name,
    country: 'BR',
  }));

  entries.push(
    { date: key(shift(easter, -48)), name: 'Carnaval (segunda-feira)', country: 'BR' },
    { date: key(shift(easter, -47)), name: 'Carnaval', country: 'BR' },
    { date: key(shift(easter, -2)), name: 'Sexta-feira Santa', country: 'BR' },
    { date: key(easter), name: 'Páscoa', country: 'BR' },
    { date: key(shift(easter, 60)), name: 'Corpus Christi', country: 'BR' },
  );

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/** Feriados estaduais/municipais de Sao Paulo usados pela demo. */
export function saoPauloHolidays(year: number): HolidayEntry[] {
  return [
    { date: key(new Date(Date.UTC(year, 0, 25))), name: 'Aniversário de São Paulo', country: 'BR', state: 'SP', city: 'Sao Paulo' },
    { date: key(new Date(Date.UTC(year, 6, 9))), name: 'Revolução Constitucionalista', country: 'BR', state: 'SP', city: '' },
  ];
}
