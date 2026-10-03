/**
 * Interpretacao da coluna "FREQUENCIA DE VISITA" e das instrucoes de data.
 *
 * A planilha real e escrita a mao, em portugues livre: "1x no mês sempre
 * sexta", "2x no mês em dias alternados, um dia na quinta", "1x no mês de
 * prefencia terça" (sic). Em vez de exigir um formato rigido — que ninguem
 * segue numa planilha mantida no dia a dia —, extraimos as tres coisas que
 * importam para o planejamento:
 *  - quantas visitas no mes (vazio = fora do mes);
 *  - restricao de dia da semana: obrigatoria, preferida, ou "uma das visitas";
 *  - dias a evitar, que viram restricao obrigatoria (todos menos esses).
 */

export interface VisitFrequency {
  /** Visitas no mes. 0 = nao visitar neste mes. */
  visits: number;
  /** Toda visita deve cair num destes dias (0=dom..6=sab). Vazio = qualquer dia. */
  allowedWeekdays: number[];
  /** Preferencia nao obrigatoria. */
  preferredWeekdays: number[];
  /** Com 2+ visitas: uma delas deve cair neste dia. */
  oneVisitWeekday: number | null;
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const WEEKDAY_PATTERN = /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?\b/g;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function parseVisitFrequency(raw: string | null | undefined): VisitFrequency {
  const text = normalize(raw ?? '');
  const empty: VisitFrequency = { visits: 0, allowedWeekdays: [], preferredWeekdays: [], oneVisitWeekday: null };
  if (!text) return empty;

  const countMatch = text.match(/(\d+)\s*x/) ?? text.match(/(\d+)\s*vez/);
  let visits = countMatch ? Number.parseInt(countMatch[1], 10) : /duas vezes/.test(text) ? 2 : 1;
  if (!Number.isFinite(visits) || visits < 0) visits = 1;
  if (visits === 0) return empty;

  const allowed: number[] = [];
  const preferred: number[] = [];
  const avoided: number[] = [];
  let oneVisitWeekday: number | null = null;

  // Cada dia citado herda o sentido da frase em que aparece: "evitar as
  // sextas", "de preferencia quarta", "um dia na quinta", "sempre sexta".
  for (const match of text.matchAll(WEEKDAY_PATTERN)) {
    const day = WEEKDAYS[match[1]];
    const before = text.slice(0, match.index ?? 0);
    const clause = before.split(/[,;.]/).pop() ?? '';

    if (/evit|exceto|menos|nao (pode|da)/.test(clause)) avoided.push(day);
    else if (/pref|se possivel|nao e obrigat|ideal/.test(clause + text.slice(match.index ?? 0))) preferred.push(day);
    else if (visits > 1 && /\b(um|1|uma)\b.*\b(dia|visita|vez)\b|\buma das\b/.test(clause)) oneVisitWeekday = day;
    else allowed.push(day);
  }

  let allowedWeekdays = unique(allowed);
  if (avoided.length > 0) {
    const base = allowedWeekdays.length > 0 ? allowedWeekdays : [0, 1, 2, 3, 4, 5, 6];
    allowedWeekdays = base.filter((d) => !avoided.includes(d));
  }

  return {
    visits,
    allowedWeekdays,
    preferredWeekdays: unique(preferred).filter((d) => !avoided.includes(d)),
    oneVisitWeekday,
  };
}

/**
 * "colocar dia 16 de outubro", "dia 05/10", "16/10/2026" -> "2026-10-16".
 *
 * Sem ano explicito, usa o ano da referencia — ou o seguinte, quando a data ja
 * passou ha mais de dois meses (instrucao escrita em dezembro para janeiro).
 * Texto sem data reconhecivel ("SET OK", numeros soltos) devolve null.
 */
export function parseFixedDate(raw: string | null | undefined, reference: Date = new Date()): string | null {
  const text = normalize(raw ?? '');
  if (!text) return null;

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  const named = text.match(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b(?:\s*(?:de\s+)?(\d{4}))?/);
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);

  if (named) {
    day = Number.parseInt(named[1], 10);
    month = MONTHS[named[2]];
    year = named[3] ? Number.parseInt(named[3], 10) : null;
  } else if (numeric) {
    day = Number.parseInt(numeric[1], 10);
    month = Number.parseInt(numeric[2], 10);
    if (numeric[3]) year = Number.parseInt(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3], 10);
  }

  if (!day || !month || month < 1 || month > 12 || day < 1 || day > 31) return null;

  if (year === null) {
    year = reference.getUTCFullYear();
    const candidate = Date.UTC(year, month - 1, day);
    const twoMonthsAgo = reference.getTime() - 62 * 24 * 3600 * 1000;
    if (candidate < twoMonthsAgo) year += 1;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // 31/02 e afins
  return date.toISOString().slice(0, 10);
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Resumo curto para a tela: "2x · uma na qui", "1x · só sex", "1x · pref. qua". */
export function describeVisitFrequency(freq: VisitFrequency): string {
  if (freq.visits === 0) return 'fora deste mês';
  const parts = [`${freq.visits}x`];
  const list = (days: number[]) => days.map((d) => WEEKDAY_SHORT[d]).join('/');
  if (freq.allowedWeekdays.length > 0 && freq.allowedWeekdays.length < 7) {
    parts.push(freq.allowedWeekdays.length >= 4 ? `sem ${list([0, 1, 2, 3, 4, 5, 6].filter((d) => !freq.allowedWeekdays.includes(d) && d !== 0 && d !== 6))}` : `só ${list(freq.allowedWeekdays)}`);
  }
  if (freq.oneVisitWeekday !== null) parts.push(`uma na ${WEEKDAY_SHORT[freq.oneVisitWeekday]}`);
  if (freq.preferredWeekdays.length > 0) parts.push(`pref. ${list(freq.preferredWeekdays)}`);
  return parts.join(' · ');
}
