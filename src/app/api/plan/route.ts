import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { generateMonthlyPlan } from '@/lib/services/planning';

const schema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  targetVisits: z.number().int().min(1).max(1000).optional(),
});

/** Gera (ou regenera) o plano do mes. */
export async function POST(request: Request) {
  return handle('api.plan', async () => {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());

    const outcome = await generateMonthlyPlan({
      userId: user.id,
      year: input.year,
      month: input.month,
      targetVisits: input.targetVisits,
    });

    return {
      planId: outcome.planId,
      executionId: outcome.executionId,
      feasibility: outcome.result.feasibility,
      statistics: outcome.result.statistics,
      warnings: outcome.result.warnings,
      analysis: outcome.analysis,
      skippedClinicIds: outcome.result.skippedClinicIds,
    };
  });
}
