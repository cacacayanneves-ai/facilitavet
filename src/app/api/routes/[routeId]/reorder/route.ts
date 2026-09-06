import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { reorderRoute } from '@/lib/services/routes';

const schema = z.object({
  clinicIds: z.array(z.string().min(1)).min(1),
  reoptimize: z.boolean().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ routeId: string }> }) {
  return handle('api.routes.reorder', async () => {
    const user = await requireApiUser();
    const { routeId } = await context.params;
    const input = schema.parse(await request.json());

    const result = await reorderRoute({
      routeId,
      userId: user.id,
      clinicIdsInOrder: input.clinicIds,
      reoptimize: input.reoptimize,
    });

    if (!result) throw new Error('Rota nao encontrada.');
    return result;
  });
}
