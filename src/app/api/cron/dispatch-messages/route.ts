import { assertCronAuthorized, handle } from '@/lib/api';
import { dispatchDueMessages } from '@/lib/services/notifications';

/**
 * Job de envio (secao 42).
 *
 * Roda a cada poucos minutos e envia o que estiver vencido no outbox. E
 * reentrante: `dedupeKey` e a transicao QUEUED -> SENDING garantem que rodar
 * duas vezes nao envia a mesma mensagem duas vezes.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle('cron.dispatch', async () => {
    assertCronAuthorized(request);
    return dispatchDueMessages();
  });
}

export const POST = GET;
