import { env } from '@/lib/env';
import { CloudApiWhatsAppProvider } from './cloud-api';
import { LogWhatsAppProvider } from './log-provider';
import type { WhatsAppProvider } from './types';

export * from './types';
export { CloudApiWhatsAppProvider, LogWhatsAppProvider };

let cached: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;
  const config = env();
  const hasCredentials =
    config.WHATSAPP_PHONE_NUMBER_ID.length > 0 && config.WHATSAPP_ACCESS_TOKEN.length > 0;

  const useCloud =
    config.WHATSAPP_PROVIDER === 'cloud-api' ||
    (config.WHATSAPP_PROVIDER === 'auto' && hasCredentials);

  cached =
    useCloud && hasCredentials
      ? new CloudApiWhatsAppProvider({
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
          accessToken: config.WHATSAPP_ACCESS_TOKEN,
          apiVersion: config.WHATSAPP_API_VERSION,
        })
      : new LogWhatsAppProvider();

  return cached;
}

export function resetWhatsAppProvider(): void {
  cached = null;
}
