import { logger } from '@/lib/logger';
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppSendResult } from './types';

/**
 * Provider de desenvolvimento: registra a mensagem no log em vez de enviar.
 *
 * O outbox continua sendo populado normalmente, entao toda a mecanica de
 * agendamento, deduplicacao e geracao de conteudo e exercitada sem credencial
 * de producao. A mensagem fica visivel na tela de Notificacoes.
 */
export class LogWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'log';
  readonly available = false;

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    logger.info('WhatsApp (modo log) — mensagem nao enviada', {
      scope: 'whatsapp',
      to: message.to,
      preview: message.body.slice(0, 160),
    });
    return {
      status: 'SKIPPED',
      provider: this.name,
      error: 'Credenciais do WhatsApp não configuradas: mensagem registrada no outbox, mas não enviada.',
    };
  }
}
