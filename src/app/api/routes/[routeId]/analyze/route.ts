import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { analyzeRoute } from '@/lib/services/planning';
import { prisma } from '@/lib/db';

/**
 * Analise contextual do dia pelo Claude.
 *
 * Endpoint separado e sob demanda de proposito: analise e opcional, custa
 * dinheiro e nao pode atrasar a geracao do plano. Se o Claude nao estiver
 * configurado, devolve `summary: null` e a interface simplesmente nao mostra
 * o bloco — nao e erro.
 */
export async function POST(_request: Request, context: { params: Promise<{ routeId: string }> }) {
  return handle('api.routes.analyze', async () => {
    const user = await requireApiUser();
    const { routeId } = await context.params;

    const owned = await prisma.route.findFirst({
      where: { id: routeId, monthlyPlan: { userId: user.id } },
      select: { id: true },
    });
    if (!owned) throw new Error('Rota não encontrada.');

    return { summary: await analyzeRoute(routeId) };
  });
}
