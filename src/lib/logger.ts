/**
 * Logs estruturados (secao 76).
 *
 * Uma linha JSON por evento, com `executionId` correlacionando todas as etapas
 * de uma mesma geracao de rota, chamada de API ou disparo de mensagem. Formato
 * pronto para ingestao em qualquer coletor (Datadog, Axiom, Vercel Logs).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  executionId?: string;
  userId?: string;
  scope?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

/** Campos cujo valor nunca deve aparecer em log. */
const REDACTED_KEYS = /(key|token|secret|password|authorization|credential)/i;

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_KEYS.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(redact(context) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
  /** Logger com contexto fixo — usado por execucao de job/planejamento. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => write('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => write('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => write('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => write('error', m, { ...base, ...c }),
    };
  },
};

export function newExecutionId(prefix = 'exec'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
