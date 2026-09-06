import { z } from 'zod';
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_PREFERENCES,
  DEFAULT_SCORE_WEIGHTS,
  type CategoryRuleSet,
  type PlannerPreferences,
  type ScoreWeights,
} from '@/lib/route-planner';

/**
 * Regras comerciais e pesos ficam no banco como JSON validado por Zod.
 *
 * Motivo (secao 69): "as regras nao podem ficar hard-coded". Guardar como JSON
 * permite ao administrador mudar frequencia, quantidades, ordem do rodizio e
 * pesos do score sem migracao de schema nem deploy. O Zod garante que um JSON
 * corrompido nao derrube o planejamento — cai para o padrao e segue.
 */

export const categoryRuleSchema = z.object({
  frequency: z.enum(['monthly', 'alternating', 'manual']),
  targetCount: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
});

export const categoryRuleSetSchema = z.object({
  rules: z.object({
    CAT1: categoryRuleSchema,
    CAT2: categoryRuleSchema,
    CAT3: categoryRuleSchema,
  }),
  alternatingOrder: z.array(z.enum(['CAT1', 'CAT2', 'CAT3'])).min(0).max(3),
  anchorMonth: z.number().int().min(1).max(12),
  anchorYear: z.number().int().min(2000).max(2100),
  enforceExclusivity: z.boolean(),
});

export const scoreWeightsSchema = z.object({
  duration: z.number().min(0).max(100),
  distance: z.number().min(0).max(100),
  backtracking: z.number().min(0).max(100),
  detour: z.number().min(0).max(100),
  concentration: z.number().min(0).max(100),
  balance: z.number().min(0).max(100),
});

export function parseCategoryRules(value: unknown): CategoryRuleSet {
  const result = categoryRuleSetSchema.safeParse(value);
  return result.success ? (result.data as CategoryRuleSet) : DEFAULT_CATEGORY_RULES;
}

export function parseScoreWeights(value: unknown): ScoreWeights {
  const result = scoreWeightsSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_SCORE_WEIGHTS;
}

export interface SettingsLike {
  workStartTime: string;
  workEndTime: string;
  lunchStart: string | null;
  lunchEnd: string | null;
  visitDurationMinutes: number;
  minutesPerExtraVeterinarian?: number;
  bufferMinutes: number;
  minDaysBetweenSplitVisits?: number;
  minVisitsPerDay: number;
  maxVisitsPerDay: number;
  scoreWeights: unknown;
}

export function toPlannerPreferences(settings: SettingsLike, seed: number): PlannerPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    minVisitsPerDay: settings.minVisitsPerDay,
    maxVisitsPerDay: settings.maxVisitsPerDay,
    visitDurationMinutes: settings.visitDurationMinutes,
    minutesPerExtraVeterinarian:
      settings.minutesPerExtraVeterinarian ?? DEFAULT_PREFERENCES.minutesPerExtraVeterinarian,
    bufferMinutes: settings.bufferMinutes,
    minDaysBetweenSplitVisits: settings.minDaysBetweenSplitVisits ?? DEFAULT_PREFERENCES.minDaysBetweenSplitVisits,
    workStartTime: settings.workStartTime,
    workEndTime: settings.workEndTime,
    lunchStart: settings.lunchStart,
    lunchEnd: settings.lunchEnd,
    scoreWeights: parseScoreWeights(settings.scoreWeights),
    seed,
  };
}

/**
 * Resolve origem e destino a partir das configuracoes (secoes 25 e 26).
 * `LAST_VISIT` devolve null de proposito: o motor entende null como
 * "encadeie a partir da ultima parada do dia anterior".
 */
export function resolveAnchor(
  type: 'HOME' | 'OFFICE' | 'LAST_VISIT' | 'MANUAL' | 'NONE',
  address: string | null,
  lat: number | null,
  lng: number | null,
): { label: string; lat: number; lng: number } | null {
  if (type === 'NONE' || type === 'LAST_VISIT') return null;
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const labels: Record<string, string> = { HOME: 'Casa', OFFICE: 'Escritorio', MANUAL: 'Endereco manual' };
  return { label: address?.trim() || labels[type] || 'Origem', lat, lng };
}
