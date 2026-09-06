export interface WhatsAppMessage {
  /** E.164 sem "+", ex.: 5511999998888 */
  to: string;
  body: string;
  /** Quando definido, envia como template aprovado em vez de texto livre. */
  template?: { name: string; language: string; parameters: string[] };
}

export interface WhatsAppSendResult {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  providerRef?: string;
  error?: string;
  provider: string;
}

/**
 * Contrato de mensageria (secao 41).
 *
 * Priorizamos solucao oficial (WhatsApp Cloud API). Automacao de navegador
 * esta explicitamente fora: e fragil, viola os termos e quebra sem aviso.
 * Trocar por Twilio/360dialog e implementar esta interface.
 */
export interface WhatsAppProvider {
  readonly name: string;
  readonly available: boolean;
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

/** Normaliza um telefone brasileiro para E.164 sem o "+". */
export function normalizePhone(raw: string, defaultCountry = '55'): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith(defaultCountry) && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `${defaultCountry}${digits}`;
  return digits;
}
