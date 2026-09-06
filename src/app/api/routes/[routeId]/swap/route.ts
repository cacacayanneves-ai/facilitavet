import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { swapStop } from '@/lib/services/routes';

const schema = z.object({
  sequence: z.number().int().min(1),
  clinicId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ routeId: string }> }) {
  return handle('api.routes.swap', async () => {
    const user = await requireApiUser();
    const { routeId } = await context.params;
    const input = schema.parse(await request.json());

    const result = await swapStop({
      routeId,
      userId: user.id,
      sequence: input.sequence,
      replacementClinicId: input.clinicId,
    });

    if (!result) throw new Error('Rota nao encontrada.');
    return result;
  });
}
