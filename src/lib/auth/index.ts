import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { readSession } from './session';

export * from './session';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 11);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Usuario autenticado com settings — null quando nao ha sessao valida. */
export async function getCurrentUser() {
  const session = await readSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { settings: true, organization: true },
  });

  if (!user || !user.settings) return null;
  return user;
}

/** Guard para paginas e rotas: redireciona ao login quando nao autenticado. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Guard para APIs: lanca erro tratado pelo handler em vez de redirecionar. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Nao autenticado');
    this.name = 'UnauthorizedError';
  }
}

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
