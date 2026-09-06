import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { buildWorkCalendar, fromDateKey } from '@/lib/services/calendar';

export async function GET(request: Request) {
  return handle('api.calendar.get', async () => {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    const year = Number.parseInt(params.get('year') ?? '', 10) || new Date().getUTCFullYear();
    const month = Number.parseInt(params.get('month') ?? '', 10) || new Date().getUTCMonth() + 1;

    const calendar = await buildWorkCalendar({
      userId: user.id,
      organizationId: user.organizationId,
      year,
      month,
      workDays: user.settings!.workDays,
      country: user.settings!.country,
      state: user.settings!.state,
      city: user.settings!.city,
    });

    return { calendar };
  });
}

const blockSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blocked: z.boolean(),
  reason: z.string().max(200).optional(),
});

/** Bloqueia ou libera um dia especifico (secao 17). */
export async function POST(request: Request) {
  return handle('api.calendar.block', async () => {
    const user = await requireApiUser();
    const input = blockSchema.parse(await request.json());
    const date = fromDateKey(input.date);

    if (input.blocked) {
      await prisma.blockedDay.upsert({
        where: { userId_date: { userId: user.id, date } },
        create: { userId: user.id, date, reason: input.reason ?? null },
        update: { reason: input.reason ?? null },
      });
    } else {
      await prisma.blockedDay.deleteMany({ where: { userId: user.id, date } });
    }

    return { date: input.date, blocked: input.blocked };
  });
}
