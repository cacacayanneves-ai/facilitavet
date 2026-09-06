import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { UnauthorizedError } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Envelope de resposta e tratamento de erro compartilhados.
 *
 * Nunca vazamos stack trace nem mensagem interna para o cliente: o log
 * estruturado guarda o detalhe, a resposta carrega o que o usuario pode ler.
 */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function handle<T>(
  scope: string,
  action: () => Promise<T>,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await action());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail('Sessão expirada. Entre novamente.', 401);
    }
    if (error instanceof ZodError) {
      return fail('Dados inválidos.', 422, error.issues.map((i) => ({ path: i.path, message: i.message })));
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('Erro na API', { scope, error: message });

    // Erros de regra de negocio sao lancados com mensagem legivel e devem
    // chegar ao usuario; qualquer outra coisa vira mensagem generica.
    const isBusinessError = error instanceof Error && error.name === 'Error' && message.length < 240;
    return fail(isBusinessError ? message : 'Erro interno. Tente novamente.', 500);
  }
}

/** Autorizacao dos jobs agendados (secao 62). */
export function assertCronAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // sem segredo configurado, so roda em dev
  const header = request.headers.get('authorization') ?? '';
  if (header !== `Bearer ${secret}`) {
    throw new UnauthorizedError();
  }
}
