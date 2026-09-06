import { prisma } from '@/lib/db';
import { logger, newExecutionId } from '@/lib/logger';
import { getWhatsAppProvider, normalizePhone } from '@/lib/providers/whatsapp';
import { env } from '@/lib/env';
import { isWorkingDay, toDateKey } from './calendar';
import {
  buildFullRouteUrl,
  buildRouteMessage,
  routeUrlFor,
} from './whatsapp-message';

/**
 * AGENDAMENTO NA NUVEM (secoes 39, 42 e 43).
 *
 * Duas etapas separadas de proposito:
 *
 *   1. `prepareDailyMessages` roda antes do horario de envio (07:55 por
 *      padrao). Verifica feriado, dia bloqueado e existencia de roteiro,
 *      monta a mensagem a partir do estado ATUAL do roteiro e enfileira.
 *   2. `dispatchDueMessages` roda a cada poucos minutos e envia o que estiver
 *      vencido.
 *
 * Por que separar: a mensagem precisa refletir alteracoes manuais feitas ate o
 * ultimo momento, e o envio precisa ser reentrante. Se o job de envio rodar
 * duas vezes, `dedupeKey` garante que a mensagem sai uma vez so.
 *
 * Nada disso depende de um computador ligado — sao rotas HTTP acionadas por
 * cron da plataforma (vercel.json).
 */

export interface PrepareResult {
  prepared: number;
  skipped: Array<{ userId: string; reason: string }>;
  executionId: string;
}

export async function prepareDailyMessages(options: { date?: string } = {}): Promise<PrepareResult> {
  const executionId = newExecutionId('notify');
  const log = logger.child({ executionId, scope: 'notifications.prepare' });
  const dateKey = options.date ?? toDateKey(new Date());

  const users = await prisma.user.findMany({
    include: { settings: true },
  });

  let prepared = 0;
  const skipped: Array<{ userId: string; reason: string }> = [];

  for (const user of users) {
    const settings = user.settings;
    if (!settings) continue;

    if (!settings.whatsappEnabled) {
      skipped.push({ userId: user.id, reason: 'WhatsApp desativado nas configuracoes' });
      continue;
    }

    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
    if (!settings.whatsappDays.includes(weekday)) {
      skipped.push({ userId: user.id, reason: 'Dia da semana fora da configuracao de envio' });
      continue;
    }

    // Feriado, fim de semana e bloqueio manual: nao envia (secao 39).
    const workday = await isWorkingDay({
      userId: user.id,
      organizationId: user.organizationId,
      workDays: settings.workDays,
      country: settings.country,
      state: settings.state,
      city: settings.city,
      date: dateKey,
    });
    if (!workday.working) {
      skipped.push({
        userId: user.id,
        reason: workday.reason === 'HOLIDAY' ? `Feriado: ${workday.holidayName}` : `Dia indisponivel (${workday.reason})`,
      });
      continue;
    }

    const phone = normalizePhone(settings.whatsappNumber ?? user.phone ?? '');
    if (!phone) {
      skipped.push({ userId: user.id, reason: 'Sem numero de WhatsApp valido' });
      continue;
    }

    const route = await prisma.route.findFirst({
      where: { date: new Date(`${dateKey}T00:00:00.000Z`), monthlyPlan: { userId: user.id } },
      include: {
        stops: { orderBy: { sequence: 'asc' }, include: { clinic: true, visit: true } },
      },
    });

    if (!route || route.stops.length === 0) {
      skipped.push({ userId: user.id, reason: 'Sem roteiro para o dia' });
      continue;
    }

    // A mensagem ignora visitas canceladas: enviar uma parada cancelada as 08h
    // e pior do que nao enviar nada.
    const activeStops = route.stops.filter((s) => s.visit?.status !== 'CANCELLED');
    if (activeStops.length === 0) {
      skipped.push({ userId: user.id, reason: 'Todas as visitas do dia foram canceladas' });
      continue;
    }

    const body = buildRouteMessage({
      date: route.date,
      stops: activeStops.map((stop, index) => ({
        sequence: index + 1,
        time: stop.estimatedArrival ? formatTime(stop.estimatedArrival) : '--:--',
        clinicName: stop.clinic.name,
        neighborhood: stop.clinic.neighborhood,
        veterinarians: stop.veterinarians,
      })),
      totalDistanceMeters: route.totalDistanceMeters,
      totalDurationSeconds: route.totalDurationSeconds,
      estimated: route.matrixProvider === 'offline-geometric',
      routeUrl: routeUrlFor(dateKey),
      mapUrl:
        buildFullRouteUrl({
          origin:
            route.originLatitude !== null && route.originLongitude !== null
              ? { lat: route.originLatitude, lng: route.originLongitude }
              : null,
          stops: activeStops
            .filter((s) => s.clinic.latitude !== null && s.clinic.longitude !== null)
            .map((s) => ({ lat: s.clinic.latitude!, lng: s.clinic.longitude! })),
          destination:
            route.destinationLatitude !== null && route.destinationLongitude !== null
              ? { lat: route.destinationLatitude, lng: route.destinationLongitude }
              : null,
        }) ?? undefined,
      include: {
        route: settings.whatsappIncludeRoute,
        distance: settings.whatsappIncludeDistance,
        times: settings.whatsappIncludeTimes,
        mapLink: settings.whatsappIncludeMapLink,
      },
    });

    const scheduledFor = new Date(`${dateKey}T${settings.whatsappTime}:00.000Z`);
    const dedupeKey = `daily-route:${user.id}:${dateKey}`;

    // Upsert: preparar de novo antes do envio ATUALIZA o texto (secao 43),
    // mas nunca duplica nem reescreve algo ja enviado.
    const existing = await prisma.outboxMessage.findUnique({ where: { dedupeKey } });
    if (existing && existing.status !== 'QUEUED') {
      skipped.push({ userId: user.id, reason: `Mensagem ja processada (${existing.status})` });
      continue;
    }

    await prisma.outboxMessage.upsert({
      where: { dedupeKey },
      create: {
        userId: user.id,
        dedupeKey,
        recipient: phone,
        scheduledFor,
        body,
        payload: { routeId: route.id, date: dateKey, stops: activeStops.length } as unknown as object,
      },
      update: {
        recipient: phone,
        scheduledFor,
        body,
        payload: { routeId: route.id, date: dateKey, stops: activeStops.length } as unknown as object,
      },
    });

    prepared += 1;
  }

  log.info('Mensagens preparadas', { date: dateKey, prepared, skipped: skipped.length });
  return { prepared, skipped, executionId };
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  executionId: string;
}

export async function dispatchDueMessages(options: { limit?: number } = {}): Promise<DispatchResult> {
  const executionId = newExecutionId('dispatch');
  const log = logger.child({ executionId, scope: 'notifications.dispatch' });
  const provider = getWhatsAppProvider();
  const config = env();

  const due = await prisma.outboxMessage.findMany({
    where: { status: 'QUEUED', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: options.limit ?? 50,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const message of due) {
    // Marca como SENDING antes de chamar o provider: se o processo morrer no
    // meio, a mensagem nao e reenviada as cegas na proxima rodada.
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });

    const result = await provider.send({
      to: message.recipient,
      body: message.body,
      ...(config.WHATSAPP_TEMPLATE_NAME
        ? {
            template: {
              name: config.WHATSAPP_TEMPLATE_NAME,
              language: config.WHATSAPP_TEMPLATE_LANGUAGE,
              parameters: [message.body],
            },
          }
        : {}),
    });

    if (result.status === 'SENT') sent += 1;
    else if (result.status === 'SKIPPED') skipped += 1;
    else failed += 1;

    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: result.status === 'SENT' ? 'SENT' : result.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED',
        sentAt: result.status === 'SENT' ? new Date() : null,
        providerRef: result.providerRef ?? null,
        error: result.error ?? null,
      },
    });
  }

  log.info('Mensagens despachadas', { provider: provider.name, sent, failed, skipped });
  return { sent, failed, skipped, executionId };
}

function formatTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
