import { assertCronAuthorized, handle } from '@/lib/api';
import { prepareDailyMessages } from '@/lib/services/notifications';

/**
 * Job das 07:55 (secao 42).
 *
 * Roda na nuvem, acionado pelo cron da plataforma (vercel.json) — nao depende
 * de nenhum computador ligado. Verifica feriado, dia bloqueado e existencia de
 * roteiro, monta a mensagem com o estado ATUAL do dia e enfileira no outbox.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle('cron.prepare', async () => {
    assertCronAuthorized(request);
    const date = new URL(request.url).searchParams.get('date') ?? undefined;
    return prepareDailyMessages({ date });
  });
}

export const POST = GET;
