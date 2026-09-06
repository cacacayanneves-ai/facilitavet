import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { updateVisitStatus } from '@/lib/services/visits';

const schema = z.object({
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']),
  notes: z.string().max(2000).optional(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ visitId: string }> }) {
  return handle('api.visits.update', async () => {
    const user = await requireApiUser();
    const { visitId } = await context.params;
    const input = schema.parse(await request.json());

    const visit = await updateVisitStatus({ visitId, userId: user.id, ...input });
    if (!visit) throw new Error('Visita não encontrada.');

    return {
      id: visit.id,
      status: visit.status,
      completedAt: visit.completedAt,
      clinicName: visit.clinic.name,
    };
  });
}
