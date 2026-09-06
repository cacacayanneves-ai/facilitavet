import { fail, handle } from '@/lib/api';
import { prisma } from '@/lib/db';
import { seedDemoData } from '@/lib/services/seed-demo';

/**
 * Popula a organizacao de demonstracao a partir do runtime da app.
 *
 * Existe porque nem todo ambiente de build/CI alcanca o banco diretamente
 * (ex.: Neon atras de rede corporativa restrita) — o runtime da propria
 * aplicacao ja fala com o banco normalmente, entao rodamos o seed por aqui,
 * protegido pelo mesmo segredo dos jobs de cron. Chame uma vez apos o
 * primeiro deploy e depois pode remover esta rota.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    return fail('Não autorizado.', 401);
  }

  return handle('admin.seed', () => seedDemoData(prisma));
}
