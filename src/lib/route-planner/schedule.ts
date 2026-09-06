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
  /** Duracao base do atendimento (primeiro veterinario). */
  visitDurationMinutes: number;
  /** Minutos adicionais por veterinario alem do primeiro. */
  minutesPerExtraVeterinarian: number;
  bufferMinutes: number;
}

/**
 * Duracao de uma parada em funcao do numero de veterinarios.
 *
 * Falar com 3 veterinarios na mesma clinica nao leva 3x o tempo — a chegada, a
 * espera e a montagem do material acontecem uma vez so — mas tambem nao leva o
 * mesmo tempo de falar com um. Modelamos como base + incremento por
 * veterinario extra, ambos configuraveis.
 */
export function stopDurationMinutes(
  veterinarians: number,
  options: Pick<ScheduleOptions, 'visitDurationMinutes' | 'minutesPerExtraVeterinarian'>,
): number {
  const vets = Math.max(1, Math.round(veterinarians || 1));
  return options.visitDurationMinutes + (vets - 1) * options.minutesPerExtraVeterinarian;
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
  stops: Array<{ travelSeconds: number; veterinarians: number }>,
  options: ScheduleOptions,
): ScheduleSlot[] {
  const start = parseTimeToMinutes(options.workStartTime);
  const lunchStart = options.lunchStart ? parseTimeToMinutes(options.lunchStart) : null;
  const lunchEnd = options.lunchEnd ? parseTimeToMinutes(options.lunchEnd) : null;

  const slots: ScheduleSlot[] = [];
  let cursor = start;

  for (const stop of stops) {
    cursor += stop.travelSeconds / 60;

    // Se a chegada cair dentro do almoco, empurra para o fim do intervalo.
    if (lunchStart !== null && lunchEnd !== null && cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
    }

    const arrival = cursor;
    const duration = stopDurationMinutes(stop.veterinarians, options);
    let departure = arrival + duration;

    // Uma visita que comeca antes e atravessa o almoco tambem e empurrada.
    if (lunchStart !== null && lunchEnd !== null && arrival < lunchStart && departure > lunchStart) {
      departure = lunchEnd + duration;
    }

    slots.push({ arrivalMinutes: arrival, departureMinutes: departure });
    cursor = departure + options.bufferMinutes;
  }

  return slots;
}
