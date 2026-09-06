import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { getMapsProvider } from '@/lib/providers/maps';
import { categoryRuleSetSchema, scoreWeightsSchema } from '@/lib/services/settings';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.');

const schema = z.object({
  profile: z
    .object({
      name: z.string().min(2).max(120),
      phone: z.string().max(40).nullable().optional(),
      company: z.string().max(160).nullable().optional(),
    })
    .optional(),
  work: z
    .object({
      workDays: z.array(z.number().int().min(0).max(6)).min(1, 'Selecione ao menos um dia.'),
      workStartTime: timeSchema,
      workEndTime: timeSchema,
      lunchStart: timeSchema.nullable().optional(),
      lunchEnd: timeSchema.nullable().optional(),
      visitDurationMinutes: z.number().int().min(5).max(240),
      bufferMinutes: z.number().int().min(0).max(120),
    })
    .optional(),
  anchors: z
    .object({
      originType: z.enum(['HOME', 'OFFICE', 'LAST_VISIT', 'MANUAL', 'NONE']),
      originAddress: z.string().max(300).nullable().optional(),
      originLatitude: z.number().min(-90).max(90).nullable().optional(),
      originLongitude: z.number().min(-180).max(180).nullable().optional(),
      destinationType: z.enum(['HOME', 'OFFICE', 'LAST_VISIT', 'MANUAL', 'NONE']),
      destinationAddress: z.string().max(300).nullable().optional(),
      destinationLatitude: z.number().min(-90).max(90).nullable().optional(),
      destinationLongitude: z.number().min(-180).max(180).nullable().optional(),
      /** Geocodifica os enderecos informados antes de salvar. */
      geocode: z.boolean().optional(),
    })
    .optional(),
  targets: z
    .object({
      monthlyTarget: z.number().int().min(1).max(1000),
      minVisitsPerDay: z.number().int().min(1).max(30),
      maxVisitsPerDay: z.number().int().min(1).max(30),
    })
    .refine((v) => v.minVisitsPerDay <= v.maxVisitsPerDay, {
      message: 'O mínimo por dia não pode ser maior que o máximo.',
      path: ['minVisitsPerDay'],
    })
    .optional(),
  categoryRules: categoryRuleSetSchema.optional(),
  scoreWeights: scoreWeightsSchema.optional(),
  region: z
    .object({
      country: z.string().min(2).max(2),
      state: z.string().max(2).nullable().optional(),
      city: z.string().max(120).nullable().optional(),
    })
    .optional(),
  notifications: z
    .object({
      whatsappEnabled: z.boolean(),
      whatsappNumber: z.string().max(30).nullable().optional(),
      whatsappTime: timeSchema,
      whatsappDays: z.array(z.number().int().min(0).max(6)),
      whatsappIncludeRoute: z.boolean(),
      whatsappIncludeDistance: z.boolean(),
      whatsappIncludeTimes: z.boolean(),
      whatsappIncludeMapLink: z.boolean(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
  return handle('api.settings.update', async () => {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());

    if (input.profile) {
      await prisma.user.update({ where: { id: user.id }, data: input.profile });
    }

    const anchors = input.anchors ? { ...input.anchors } : undefined;
    let geocodeWarning: string | null = null;

    // Endereco de origem/destino sem coordenada e inutil para o motor, entao
    // geocodificamos na hora de salvar e avisamos se nao der.
    if (anchors?.geocode) {
      const maps = getMapsProvider();
      for (const prefix of ['origin', 'destination'] as const) {
        const address = anchors[`${prefix}Address`];
        const type = anchors[`${prefix}Type`];
        if (!address || type === 'NONE' || type === 'LAST_VISIT') continue;
        const result = await maps.geocode({ address, country: 'Brasil' });
        if (result.status !== 'FAILED' && result.candidates[0]) {
          anchors[`${prefix}Latitude`] = result.candidates[0].lat;
          anchors[`${prefix}Longitude`] = result.candidates[0].lng;
        } else if (anchors[`${prefix}Latitude`] == null) {
          geocodeWarning = `Não foi possível localizar o endereço de ${prefix === 'origin' ? 'origem' : 'destino'}. Informe latitude e longitude manualmente.`;
        }
      }
      delete (anchors as Record<string, unknown>).geocode;
    }

    const settings = await prisma.userSettings.update({
      where: { userId: user.id },
      data: {
        ...input.work,
        ...anchors,
        ...input.targets,
        ...input.region,
        ...input.notifications,
        ...(input.categoryRules ? { categoryRules: input.categoryRules } : {}),
        ...(input.scoreWeights ? { scoreWeights: input.scoreWeights } : {}),
      },
    });

    return { settings, geocodeWarning };
  });
}
