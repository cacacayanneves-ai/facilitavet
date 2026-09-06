import type { FeasibilityReport, PlannerClinic } from './types';

/**
 * VIABILIDADE (secao 68).
 *
 * Se o usuario pedir algo impossivel, o sistema nao "faz o que da" em silencio:
 * ele explica a matematica e propoe alternativa concreta.
 *
 * Sobre clinicas maiores que o teto diario: elas NAO sao inviaveis. Numa
 * clinica publica todos os veterinarios estao no mesmo lugar ao mesmo tempo,
 * entao a visita e uma so e vale por todos eles. O teto diario rege quantas
 * visitas se ACRESCENTA a um dia, e nao o quanto uma unica parada indivisivel
 * pode valer. Uma clinica assim simplesmente toma o dia para si.
 *
 * (Quando os veterinarios se revezam em plantao e um dia nao alcanca todos, o
 * caminho e outro: marcar a clinica para visita dividida, o que a quebra em
 * partes em dias diferentes antes de chegar aqui.)
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

  const fullDayClinics = args.clinics
    .filter((c) => Math.max(1, Math.round(c.veterinarians || 1)) > maxPerDay)
    .map((c) => ({ id: c.id, name: c.name, veterinarians: Math.round(c.veterinarians) }));

  // Cada clinica de dia inteiro consome um dia e entrega o proprio tamanho;
  // os dias restantes entregam o teto normal.
  const fullDayVisits = fullDayClinics.reduce((sum, c) => sum + c.veterinarians, 0);
  const daysForTheRest = Math.max(0, availableDays - fullDayClinics.length);
  const capacity = daysForTheRest * maxPerDay + fullDayVisits;
  const minimumCapacity = daysForTheRest * Math.max(0, minPerDay) + fullDayVisits;
  const deficit = Math.max(0, requiredVisits - capacity);

  const daysShortage = Math.max(0, fullDayClinics.length - availableDays);
  const feasible = availableDays > 0 && daysShortage === 0 && deficit === 0;

  const suggestedDays = maxPerDay > 0 ? Math.ceil(requiredVisits / maxPerDay) : 0;
  const suggestedMaxPerDay = availableDays > 0 ? Math.ceil(requiredVisits / availableDays) : 0;

  const biggest = fullDayClinics.length
    ? fullDayClinics.reduce((a, b) => (b.veterinarians > a.veterinarians ? b : a))
    : null;

  let message: string;
  if (availableDays === 0) {
    message =
      'Nenhum dia disponível no mês. Ajuste os dias de trabalho, os feriados ou os bloqueios manuais.';
  } else if (daysShortage > 0) {
    message =
      `${fullDayClinics.length} clínicas passam do limite de ${maxPerDay} visitas por dia e ocupam ` +
      `um dia cada, mas o mês só tem ${availableDays} dia(s) disponível(is). ` +
      `Aumente o limite diário ou libere mais dias.`;
  } else if (deficit > 0) {
    message =
      `Não é possível concluir as ${requiredVisits} visitas nas condições atuais. ` +
      `Com ${availableDays} dia(s) e no máximo ${maxPerDay} visita(s) por dia, a capacidade é de ${capacity} visitas, faltam ${deficit}. ` +
      `Você precisa de pelo menos ${suggestedDays} dia(s) com ${maxPerDay} visitas por dia, ou de ${suggestedMaxPerDay} visitas por dia nos ${availableDays} dias disponíveis.`;
  } else if (biggest) {
    message =
      `Plano viável: ${requiredVisits} visitas em ${requiredStops} clínicas, distribuídas em ${availableDays} dia(s). ` +
      `${fullDayClinics.length === 1 ? `${biggest.name} tem` : `${fullDayClinics.length} clínicas têm`} ` +
      `mais veterinários que o limite de ${maxPerDay} por dia ` +
      `${fullDayClinics.length === 1 ? `(${biggest.veterinarians})` : `(a maior, ${biggest.name}, tem ${biggest.veterinarians})`} ` +
      `e ocupa${fullDayClinics.length === 1 ? '' : 'm'} um dia inteiro. ` +
      `Se os veterinários de lá se revezam em plantão, marque a clínica para visita dividida.`;
  } else if (requiredVisits < minimumCapacity) {
    message =
      `Plano viável. A meta de ${requiredVisits} visitas fica abaixo do mínimo preferido de ${minPerDay} por dia, então alguns dias terão agenda curta.`;
  } else {
    message =
      `Plano viável: ${requiredVisits} visitas em ${requiredStops} clínicas, distribuídas em ${availableDays} dia(s) ` +
      `(capacidade de ${capacity} visitas).`;
  }

  return {
    feasible,
    requiredVisits,
    requiredStops,
    fullDayClinics,
    availableDays,
    capacity,
    minimumCapacity,
    deficit,
    suggestedDays,
    suggestedMaxPerDay,
    message,
  };
}
