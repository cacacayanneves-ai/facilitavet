import type { FeasibilityReport, PlannerClinic } from './types';

/**
 * VIABILIDADE (secao 68).
 *
 * Se o usuario pedir algo impossivel, o sistema nao "faz o que da" em silencio:
 * ele explica a matematica e propoe alternativa concreta.
 *
 * Com a contagem por veterinario surge um segundo tipo de inviabilidade, que
 * nao existia quando 1 clinica valia 1 visita: uma clinica cujo numero de
 * veterinarios sozinho ja estoura o teto diario. Como a clinica e atomica —
 * nao da para atender 6 dos 9 veterinarios hoje e 3 amanha — nenhum dia
 * consegue recebe-la, por mais dias que existam no mes.
 */
export function evaluateFeasibility(args: {
  requiredVisits: number;
  requiredStops: number;
  availableDays: number;
  minPerDay: number;
  maxPerDay: number;
  clinics: PlannerClinic[];
}): FeasibilityReport {
  const { requiredVisits, requiredStops, availableDays, minPerDay, maxPerDay } = args;

  const capacity = availableDays * maxPerDay;
  const minimumCapacity = availableDays * Math.max(0, minPerDay);
  const deficit = Math.max(0, requiredVisits - capacity);

  const oversizedClinics = args.clinics
    .filter((c) => Math.max(1, Math.round(c.veterinarians || 1)) > maxPerDay)
    .map((c) => ({ id: c.id, name: c.name, veterinarians: Math.round(c.veterinarians) }));

  const feasible = availableDays > 0 && deficit === 0 && oversizedClinics.length === 0;

  const suggestedDays = maxPerDay > 0 ? Math.ceil(requiredVisits / maxPerDay) : 0;
  const suggestedMaxPerDay = availableDays > 0 ? Math.ceil(requiredVisits / availableDays) : 0;

  let message: string;
  if (availableDays === 0) {
    message =
      'Nenhum dia disponível no mês. Ajuste os dias de trabalho, os feriados ou os bloqueios manuais.';
  } else if (oversizedClinics.length > 0) {
    const worst = oversizedClinics.reduce((a, b) => (b.veterinarians > a.veterinarians ? b : a));
    message =
      `${oversizedClinics.length === 1 ? 'Uma clínica tem' : `${oversizedClinics.length} clínicas têm`} ` +
      `mais veterinários que o limite de ${maxPerDay} visitas por dia — ` +
      `${worst.name} tem ${worst.veterinarians}. Uma clínica não pode ser dividida entre dois dias, ` +
      `então o limite diário precisa ser de pelo menos ${worst.veterinarians} visitas.`;
  } else if (deficit > 0) {
    message =
      `Não é possível concluir as ${requiredVisits} visitas nas condições atuais. ` +
      `Com ${availableDays} dia(s) e no máximo ${maxPerDay} visita(s) por dia, a capacidade é de ${capacity} visitas — faltam ${deficit}. ` +
      `Você precisa de pelo menos ${suggestedDays} dia(s) com ${maxPerDay} visitas por dia, ou de ${suggestedMaxPerDay} visitas por dia nos ${availableDays} dias disponíveis.`;
  } else if (requiredVisits < minimumCapacity) {
    message =
      `Plano viável. A meta de ${requiredVisits} visitas fica abaixo do mínimo preferido de ${minPerDay} por dia — alguns dias terão agenda curta.`;
  } else {
    message =
      `Plano viável: ${requiredVisits} visitas em ${requiredStops} clínicas, distribuídas em ${availableDays} dia(s) ` +
      `(capacidade de ${capacity} visitas).`;
  }

  return {
    feasible,
    requiredVisits,
    requiredStops,
    oversizedClinics,
    availableDays,
    capacity,
    minimumCapacity,
    deficit,
    suggestedDays,
    suggestedMaxPerDay,
    message,
  };
}
