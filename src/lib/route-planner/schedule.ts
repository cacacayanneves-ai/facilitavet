/**
 * Grade de horarios do dia.
 *
 * Converte a sequencia otimizada em horarios de chegada estimados, respeitando
 * inicio de jornada, duracao media de atendimento, folga entre visitas e
 * intervalo de almoco. Tudo em minutos desde a meia-noite para evitar
 * armadilhas de fuso horario — o "dia" aqui e um fato do calendario local.
 */

export interface ScheduleSlot {
  arrivalMinutes: number;
  departureMinutes: number;
}

export interface ScheduleOptions {
  workStartTime: string;
  workEndTime: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  visitDurationMinutes: number;
  bufferMinutes: number;
}

export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  const h = Math.floor(normalized / 60) % 24;
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildSchedule(
  travelSecondsToEachStop: number[],
  options: ScheduleOptions,
): ScheduleSlot[] {
  const start = parseTimeToMinutes(options.workStartTime);
  const lunchStart = options.lunchStart ? parseTimeToMinutes(options.lunchStart) : null;
  const lunchEnd = options.lunchEnd ? parseTimeToMinutes(options.lunchEnd) : null;

  const slots: ScheduleSlot[] = [];
  let cursor = start;

  for (const travelSeconds of travelSecondsToEachStop) {
    cursor += travelSeconds / 60;

    // Se a chegada cair dentro do almoco, empurra para o fim do intervalo.
    if (lunchStart !== null && lunchEnd !== null && cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
    }

    const arrival = cursor;
    let departure = arrival + options.visitDurationMinutes;

    // Uma visita que comeca antes e atravessa o almoco tambem e empurrada.
    if (lunchStart !== null && lunchEnd !== null && arrival < lunchStart && departure > lunchStart) {
      departure = lunchEnd + options.visitDurationMinutes;
    }

    slots.push({ arrivalMinutes: arrival, departureMinutes: departure });
    cursor = departure + options.bufferMinutes;
  }

  return slots;
}
