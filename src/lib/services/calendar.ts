import { prisma } from '@/lib/db';
import type { AvailableDay } from '@/lib/route-planner';

/**
 * Calendario de trabalho (secao 17).
 *
 * Um "dia" aqui e um fato do calendario local, nao um instante. Por isso
 * trabalhamos com strings "YYYY-MM-DD" e com datas em UTC meia-noite: assim
 * o dia 14/09 nao vira 13/09 as 21h ao cruzar fuso.
 */

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

export function daysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  while (cursor.getUTCMonth() === month - 1) {
    days.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export interface CalendarDay {
  date: string;
  weekday: number;
  available: boolean;
  reason: 'WEEKEND' | 'HOLIDAY' | 'BLOCKED' | 'OFF_DAY' | null;
  holidayName?: string;
  blockedReason?: string;
}

export interface WorkCalendarOptions {
  userId: string;
  organizationId: string;
  year: number;
  month: number;
  workDays: number[];
  country: string;
  state?: string | null;
  city?: string | null;
}

/**
 * Monta o calendario do mes marcando cada dia como disponivel ou nao, e
 * dizendo POR QUE nao esta disponivel. A interface precisa dessa razao para
 * explicar ao usuario em vez de simplesmente omitir o dia.
 */
export async function buildWorkCalendar(options: WorkCalendarOptions): Promise<CalendarDay[]> {
  const { start, end } = monthRange(options.year, options.month);

  const [holidays, blocked] = await Promise.all([
    prisma.holiday.findMany({
      where: {
        date: { gte: start, lte: end },
        country: options.country,
        OR: [
          { organizationId: null },
          { organizationId: options.organizationId },
        ],
        // "" abrange todo o pais/estado; o valor especifico casa com a regiao
        // configurada pelo usuario.
        AND: [
          { state: { in: ['', options.state ?? ''] } },
          { city: { in: ['', options.city ?? ''] } },
        ],
      },
    }),
    prisma.blockedDay.findMany({ where: { userId: options.userId, date: { gte: start, lte: end } } }),
  ]);

  const holidayByDate = new Map(holidays.map((h) => [toDateKey(h.date), h]));
  const blockedByDate = new Map(blocked.map((b) => [toDateKey(b.date), b]));
  const workDays = new Set(options.workDays);

  return daysInMonth(options.year, options.month).map((date) => {
    const weekday = fromDateKey(date).getUTCDay();
    const holiday = holidayByDate.get(date);
    const block = blockedByDate.get(date);

    if (block) {
      return { date, weekday, available: false, reason: 'BLOCKED', blockedReason: block.reason ?? undefined };
    }
    if (holiday) {
      return { date, weekday, available: false, reason: 'HOLIDAY', holidayName: holiday.name };
    }
    if (!workDays.has(weekday)) {
      const reason = weekday === 0 || weekday === 6 ? 'WEEKEND' : 'OFF_DAY';
      return { date, weekday, available: false, reason };
    }
    return { date, weekday, available: true, reason: null };
  });
}

export function toAvailableDays(calendar: CalendarDay[]): AvailableDay[] {
  return calendar.filter((d) => d.available).map((d) => ({ date: d.date, weekday: d.weekday }));
}

/** Um dia especifico e util para o usuario? Usado pelo job do WhatsApp. */
export async function isWorkingDay(
  options: Omit<WorkCalendarOptions, 'year' | 'month'> & { date: string },
): Promise<{ working: boolean; reason: CalendarDay['reason']; holidayName?: string }> {
  const date = fromDateKey(options.date);
  const calendar = await buildWorkCalendar({
    ...options,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  });
  const day = calendar.find((d) => d.date === options.date);
  if (!day) return { working: false, reason: null };
  return { working: day.available, reason: day.reason, holidayName: day.holidayName };
}
