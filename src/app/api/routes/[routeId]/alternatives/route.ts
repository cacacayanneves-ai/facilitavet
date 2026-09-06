import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { alternativesForStop } from '@/lib/services/routes';

export async function GET(request: Request, context: { params: Promise<{ routeId: string }> }) {
  return handle('api.routes.alternatives', async () => {
    const user = await requireApiUser();
    const { routeId } = await context.params;
    const sequence = Number.parseInt(new URL(request.url).searchParams.get('sequence') ?? '1', 10);

    const alternatives = await alternativesForStop({ routeId, userId: user.id, sequence });
    if (!alternatives) throw new Error('Rota nao encontrada.');
    return { alternatives };
  });
}
