import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { prisma } from '@/lib/db';
import { createAccount, EmailTakenError } from '@/lib/services/account';
import { logger } from '@/lib/logger';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email: z.string().email('Informe um e-mail válido.').max(160),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
  company: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
});

/** Cadastro publico: cria organizacao, usuario dono e ja abre a sessao. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Dados inválidos.', 422);
  }

  try {
    const user = await createAccount(prisma, parsed.data);
    await createSession({ userId: user.id, organizationId: user.organizationId, email: user.email });
    logger.info('Conta criada', { scope: 'auth', userId: user.id });
    return ok({ id: user.id, name: user.name, email: user.email });
  } catch (error) {
    if (error instanceof EmailTakenError) return fail(error.message, 409);
    logger.error('Falha ao criar conta', {
      scope: 'auth',
      error: error instanceof Error ? error.message : String(error),
    });
    return fail('Não foi possível criar a conta. Tente novamente.', 500);
  }
}
