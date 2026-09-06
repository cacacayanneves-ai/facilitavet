import type { FeasibilityReport } from './types';

/**
 * VIABILIDADE (secao 68).
 *
 * Se o usuario pedir algo impossivel, o sistema nao "faz o que da" em silencio:
 * ele explica a matematica e propoe alternativa concreta.
 */
export function evaluateFeasibility(
  requiredVisits: number,
  availableDays: number,
  minPerDay: number,
  maxPerDay: number,
): FeasibilityReport {
  const capacity = availableDays * maxPerDay;
  const minimumCapacity = availableDays * Math.max(0, minPerDay);
  const deficit = Math.max(0, requiredVisits - capacity);
  const feasible = availableDays > 0 && deficit === 0;

  const suggestedDays = maxPerDay > 0 ? Math.ceil(requiredVisits / maxPerDay) : 0;
  const suggestedMaxPerDay = availableDays > 0 ? Math.ceil(requiredVisits / availableDays) : 0;

  let message: string;
  if (availableDays === 0) {
    message =
      'Nenhum dia disponivel no mes. Ajuste os dias de trabalho, os feriados ou os bloqueios manuais.';
  } else if (!feasible) {
    message =
      `Nao e possivel concluir as ${requiredVisits} visitas nas condicoes atuais. ` +
      `Com ${availableDays} dia(s) e no maximo ${maxPerDay} visita(s) por dia, a capacidade e de ${capacity} visitas — faltam ${deficit}. ` +
      `Voce precisa de pelo menos ${suggestedDays} dia(s) com ${maxPerDay} visitas por dia, ou de ${suggestedMaxPerDay} visitas por dia nos ${availableDays} dias disponiveis.`;
  } else if (requiredVisits < minimumCapacity) {
    message =
      `Plano viavel. A meta de ${requiredVisits} visitas fica abaixo do minimo preferido de ${minPerDay} por dia — alguns dias terao agenda curta.`;
  } else {
    message = `Plano viavel: ${requiredVisits} visitas em ${availableDays} dia(s), dentro da capacidade de ${capacity}.`;
  }

  return {
    feasible,
    requiredVisits,
    availableDays,
    capacity,
    minimumCapacity,
    deficit,
    suggestedDays,
    suggestedMaxPerDay,
    message,
  };
}
