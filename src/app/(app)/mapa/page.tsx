import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fromDateKey, monthRange, toDateKey } from '@/lib/services/calendar';
import { Topbar } from '@/components/layout/topbar';
import { Card, EmptyState } from '@/components/ui';
import { MapWorkspace } from './map-workspace';
import { todayKey } from '@/lib/utils';

export const metadata = { title: 'Mapa' };
export const dynamic = 'force-dynamic';

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const now = new Date();
  const { start, end } = monthRange(now.getUTCFullYear(), now.getUTCMonth() + 1);

  const routes = await prisma.route.findMany({
    where: { date: { gte: start, lte: end }, monthlyPlan: { userId: user.id } },
    orderBy: { date: 'asc' },
    include: { stops: { orderBy: { sequence: 'asc' }, include: { clinic: true, visit: true } } },
  });

  const clinics = await prisma.clinic.findMany({
    where: {
      organizationId: user.organizationId,
      active: true,
      latitude: { not: null },
      longitude: { not: null },
    },
    select: { id: true, name: true, neighborhood: true, category: true, latitude: true, longitude: true },
    take: 800,
  });

  if (routes.length === 0) {
    return (
      <>
        <Topbar title="Mapa" />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Card>
            <EmptyState
              title="Nenhuma rota para exibir"
              description="Gere o planejamento do mês para ver as rotas no mapa."
            />
          </Card>
        </main>
      </>
    );
  }

  const requested = params.date ?? todayKey();
  const serialized = routes.map((route) => ({
    id: route.id,
    date: toDateKey(route.date),
    regionLabel: route.regionLabel,
    totalDistanceMeters: route.totalDistanceMeters,
    totalDurationSeconds: route.totalDurationSeconds,
    score: route.score,
    origin:
      route.originLatitude !== null && route.originLongitude !== null
        ? { lat: route.originLatitude, lng: route.originLongitude, label: route.originLabel ?? 'Origem' }
        : null,
    destination:
      route.destinationLatitude !== null && route.destinationLongitude !== null
        ? {
            lat: route.destinationLatitude,
            lng: route.destinationLongitude,
            label: route.destinationLabel ?? 'Destino',
          }
        : null,
    stops: route.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      clinicId: stop.clinicId,
      clinicName: stop.clinic.name,
      neighborhood: stop.clinic.neighborhood,
      address: stop.clinic.address,
      category: stop.clinic.category,
      lat: stop.clinic.latitude,
      lng: stop.clinic.longitude,
      estimatedArrival: stop.estimatedArrival?.toISOString() ?? null,
      distanceFromPreviousMeters: stop.distanceFromPreviousMeters,
      durationFromPreviousSeconds: stop.durationFromPreviousSeconds,
      visitId: stop.visit?.id ?? null,
      status: stop.visit?.status ?? 'PLANNED',
      veterinarians: stop.veterinarians,
      part: stop.part,
      totalParts: stop.totalParts,
    })),
  }));

  const initial = serialized.find((r) => r.date === requested)?.date ?? serialized[0].date;

  return (
    <>
      <Topbar title="Mapa" subtitle="Visualização geográfica das rotas do mês" />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <MapWorkspace
          routes={serialized}
          initialDate={initial}
          clinics={clinics.map((c) => ({
            id: c.id,
            name: c.name,
            neighborhood: c.neighborhood,
            category: c.category,
            lat: c.latitude!,
            lng: c.longitude!,
          }))}
          browserMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ''}
        />
      </main>
    </>
  );
}
