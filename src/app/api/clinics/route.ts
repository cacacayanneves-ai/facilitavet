import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { handle } from '@/lib/api';
import { getMapsProvider } from '@/lib/providers/maps';

const createSchema = z.object({
  name: z.string().min(2).max(200),
  category: z.enum(['CAT1', 'CAT2', 'CAT3']),
  address: z.string().max(300).optional().nullable(),
  neighborhood: z.string().max(120).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  active: z.boolean().optional(),
  /** Tenta geocodificar quando nao vierem coordenadas. */
  geocode: z.boolean().optional(),
});

export async function GET(request: Request) {
  return handle('api.clinics.list', async () => {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    const search = params.get('q')?.trim();
    const category = params.get('category');
    const filter = params.get('filter');

    const clinics = await prisma.clinic.findMany({
      where: {
        organizationId: user.organizationId,
        ...(category && category !== 'ALL' ? { category: category as 'CAT1' } : {}),
        ...(filter === 'no-location' ? { OR: [{ latitude: null }, { longitude: null }] } : {}),
        ...(filter === 'no-address' ? { address: null } : {}),
        ...(filter === 'inactive' ? { active: false } : filter ? { active: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { neighborhood: { contains: search, mode: 'insensitive' as const } },
                { city: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 500,
    });

    return { clinics };
  });
}

export async function POST(request: Request) {
  return handle('api.clinics.create', async () => {
    const user = await requireApiUser();
    const input = createSchema.parse(await request.json());

    let latitude = input.latitude ?? null;
    let longitude = input.longitude ?? null;
    let geocodeStatus: 'MANUAL' | 'RESOLVED' | 'FAILED' | 'PENDING' =
      latitude !== null && longitude !== null ? 'MANUAL' : 'PENDING';
    let geocodeLabel: string | null = null;

    if (latitude === null && input.geocode !== false) {
      const result = await getMapsProvider().geocode({
        name: input.name,
        address: input.address,
        neighborhood: input.neighborhood,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: 'Brasil',
      });
      if (result.status === 'RESOLVED' && result.candidates[0]) {
        latitude = result.candidates[0].lat;
        longitude = result.candidates[0].lng;
        geocodeLabel = result.candidates[0].label;
        geocodeStatus = 'RESOLVED';
      } else {
        geocodeStatus = 'FAILED';
        geocodeLabel = result.reason ?? 'Nao foi possivel localizar.';
      }
    }

    const clinic = await prisma.clinic.create({
      data: {
        organizationId: user.organizationId,
        name: input.name,
        category: input.category,
        address: input.address ?? null,
        neighborhood: input.neighborhood ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        latitude,
        longitude,
        geocodeStatus,
        geocodeLabel,
        geocodedAt: latitude !== null ? new Date() : null,
        active: input.active ?? true,
      },
    });

    return { clinic };
  });
}
