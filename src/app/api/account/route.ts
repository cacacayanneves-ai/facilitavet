import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle } from '@/lib/api';
import { hashPassword, requireApiUser, verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Troca de e-mail e senha (dados de acesso).
 *
 * Separado de /api/settings de proposito: mexer em credencial exige a senha
 * atual, enquanto o resto das configuracoes salva livremente com a sessao
 * aberta. Misturar os dois deixaria uma sessao esquecida trocar a senha.
 */
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    email: z.string().email('E-mail inválido.').max(160).optional(),
    newPassword: z
      .string()
      .min(8, 'A nova senha precisa de pelo menos 8 caracteres.')
      .max(200)
      .optional(),
  })
  .refine((v) => v.email || v.newPassword, {
    message: 'Informe um novo e-mail ou uma nova senha.',
  });

export async function PATCH(request: Request) {
  return handle('api.account.update', async () => {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new Error('Senha atual incorreta.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.email && input.email !== user.email) data.email = input.email;
    if (input.newPassword) data.passwordHash = await hashPassword(input.newPassword);

    if (Object.keys(data).length === 0) {
      return { email: user.email, emailChanged: false, passwordChanged: false };
    }

    try {
      const updated = await prisma.user.update({ where: { id: user.id }, data });
      return {
        email: updated.email,
        emailChanged: data.email != null,
        passwordChanged: data.passwordHash != null,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('Já existe uma conta com esse e-mail.');
      }
      throw error;
    }
  });
}
