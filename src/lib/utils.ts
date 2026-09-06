import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* --------------------------------------------------------------------------
 * Formatadores compartilhados.
 * Centralizados para que "42 km" e "3h10" tenham a MESMA aparencia no
 * dashboard, no calendario, no mapa e na mensagem do WhatsApp.
 * ------------------------------------------------------------------------ */

export function formatKm(meters: number, decimals = 0): string {
  return `${(meters / 1000).toFixed(decimals).replace('.', ',')} km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return '--:--';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS_LONG = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado',
];
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export function weekdayLong(index: number): string {
  return WEEKDAYS_LONG[index] ?? '';
}
export function weekdayShort(index: number): string {
  return WEEKDAYS_SHORT[index] ?? '';
}
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}
export function monthShort(month: number): string {
  return MONTHS_SHORT[month - 1] ?? '';
}

/** "14/09/2026" a partir de "2026-09-14" ou Date (sempre em UTC). */
export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

/** "Segunda-feira, 14 de setembro" */
export function formatDateLong(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return `${weekdayLong(date.getUTCDay())}, ${date.getUTCDate()} de ${monthName(date.getUTCMonth() + 1)}`;
}

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function percent(value: number): string {
  return `${Math.round(value)}%`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  CAT1: 'Cat 1',
  CAT2: 'Cat 2',
  CAT3: 'Cat 3',
};

export const VISIT_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planejada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  RESCHEDULED: 'Remarcada',
};

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
