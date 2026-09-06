import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession, verifyPassword } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { logger } from '@/lib/logger';

const schema = z.object({
  email: z.string().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

/**
 * Login.
 *
 * Duas decisoes de seguranca deliberadas:
 *  - a resposta e a MESMA para "e-mail inexistente" e "senha errada", para nao
 *    virar um oraculo de quais e-mails existem na base;
 *  - quando o usuario nao existe ainda assim comparamos contra um hash falso,
 *    para que o tempo de resposta nao denuncie a diferenca.
 */
const DUMMY_HASH = '$2a$11$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Dados inválidos.', 422);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    logger.warn('Tentativa de login sem sucesso', { scope: 'auth', email });
    return fail('E-mail ou senha inválidos.', 401);
  }

  await createSession({ userId: user.id, organizationId: user.organizationId, email: user.email });
  logger.info('Login realizado', { scope: 'auth', userId: user.id });

  return ok({ id: user.id, name: user.name, email: user.email });
}
