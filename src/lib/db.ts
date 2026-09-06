import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma singleton.
 *
 * Em desenvolvimento o hot-reload do Next recria modulos a cada alteracao;
 * sem o cache global isso abriria um pool novo de conexoes por reload ate
 * estourar o limite do Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
