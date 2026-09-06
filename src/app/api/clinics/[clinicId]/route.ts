import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { getClinicHistory } from '@/lib/services/visits';

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  category: z.enum(['CAT1', 'CAT2', 'CAT3']).optional(),
  address: z.string().max(300).nullable().optional(),
  neighborhood: z.string().max(120).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(2).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  active: z.boolean().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ clinicId: string }> }) {
  return handle('api.clinics.get', async () => {
    const user = await requireApiUser();
    const { clinicId } = await context.params;
    const history = await getClinicHistory(clinicId, user.organizationId);
    if (!history) throw new Error('Clinica nao encontrada.');
    return history;
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ clinicId: string }> }) {
  return handle('api.clinics.update', async () => {
    const user = await requireApiUser();
    const { clinicId } = await context.params;
    const input = updateSchema.parse(await request.json());

    const existing = await prisma.clinic.findFirst({
      where: { id: clinicId, organizationId: user.organizationId },
    });
    if (!existing) throw new Error('Clinica nao encontrada.');

    // Corrigir coordenada manualmente marca a clinica como localizada: e uma
    // decisao humana explicita e vale mais que o palpite do geocoder.
    const coordinatesChanged =
      (input.latitude !== undefined && input.latitude !== existing.latitude) ||
      (input.longitude !== undefined && input.longitude !== existing.longitude);

    const clinic = await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        ...input,
        ...(coordinatesChanged && input.latitude !== null && input.longitude !== null
          ? { geocodeStatus: 'MANUAL' as const, geocodedAt: new Date(), geocodeLabel: 'Ajustado manualmente' }
          : {}),
      },
    });

    return { clinic };
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ clinicId: string }> }) {
  return handle('api.clinics.delete', async () => {
    const user = await requireApiUser();
    const { clinicId } = await context.params;

    const existing = await prisma.clinic.findFirst({
      where: { id: clinicId, organizationId: user.organizationId },
    });
    if (!existing) throw new Error('Clinica nao encontrada.');

    // Desativamos em vez de apagar: apagar destruiria o historico de visitas
    // da clinica, que e informacao comercial acumulada.
    await prisma.clinic.update({ where: { id: clinicId }, data: { active: false } });
    return { ok: true, deactivated: true };
  });
}
