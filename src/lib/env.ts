import { z } from 'zod';

/**
 * Validacao de ambiente em um unico lugar.
 *
 * Segredos NUNCA chegam ao browser: tudo aqui e lido em codigo de servidor.
 * As unicas variaveis publicas usam o prefixo NEXT_PUBLIC_ e sao, por
 * definicao, chaves restritas por referenciador (nao segredos).
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatorio'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET precisa de no minimo 32 caracteres'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
  MAPS_PROVIDER: z.enum(['auto', 'google', 'offline']).default('auto'),
  MAPS_MATRIX_ELEMENT_BUDGET: z.coerce.number().int().positive().default(4000),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5'),
  CLAUDE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  WHATSAPP_PROVIDER: z.enum(['auto', 'cloud-api', 'log']).default('auto'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TEMPLATE_NAME: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('pt_BR'),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
  WHATSAPP_APP_SECRET: z.string().optional().default(''),

  CRON_SECRET: z.string().optional().default(''),

  DEMO_EMAIL: z.string().default('demo@facilitavet.app'),
  DEMO_PASSWORD: z.string().default('facilitavet'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${issues}\n\nCopie .env.example para .env.`);
  }
  cached = parsed.data;
  return cached;
}

/** Chave restrita por referenciador — a unica exposta ao browser. */
export const browserMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? '';
