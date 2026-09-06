import { logger } from '@/lib/logger';
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppSendResult } from './types';

/**
 * WhatsApp Cloud API (Meta) — solucao oficial.
 *
 * Sobre templates: fora da janela de 24 horas de atendimento, a Meta so
 * permite mensagens a partir de template aprovado. O roteiro diario e uma
 * notificacao proativa, entao em producao ele deve usar um template
 * (WHATSAPP_TEMPLATE_NAME). Sem template configurado, enviamos texto livre —
 * o que funciona em ambiente de teste e dentro da janela de conversa.
 */
export class CloudApiWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'whatsapp-cloud-api';
  readonly available = true;

  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;

  constructor(options: { phoneNumberId: string; accessToken: string; apiVersion: string }) {
    this.phoneNumberId = options.phoneNumberId;
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion;
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = message.template
      ? {
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: message.template.name,
            language: { code: message.template.language },
            components: [
              {
                type: 'body',
                parameters: message.template.parameters.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'text',
          text: { preview_url: true, body: message.body },
        };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });

      const json = (await response.json().catch(() => ({}))) as CloudApiResponse;

      if (!response.ok) {
        const reason = json.error?.message ?? `HTTP ${response.status}`;
        logger.error('Falha ao enviar WhatsApp', { scope: 'whatsapp', status: response.status, reason });
        return { status: 'FAILED', provider: this.name, error: reason };
      }

      return { status: 'SENT', provider: this.name, providerRef: json.messages?.[0]?.id };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error('Erro de rede ao enviar WhatsApp', { scope: 'whatsapp', reason });
      return { status: 'FAILED', provider: this.name, error: reason };
    }
  }
}

interface CloudApiResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; code?: number };
}
