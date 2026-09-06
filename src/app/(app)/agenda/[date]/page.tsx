import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fromDateKey } from '@/lib/services/calendar';
import { Topbar } from '@/components/layout/topbar';
import { DayWorkspace } from './day-workspace';
import { formatDateLong } from '@/lib/utils';
import type { SerializedRoute } from '@/components/route/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return { title: formatDateLong(date) };
}

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const user = await requireUser();
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const route = await prisma.route.findFirst({
    where: { date: fromDateKey(date), monthlyPlan: { userId: user.id } },
    include: {
      stops: { orderBy: { sequence: 'asc' }, include: { clinic: true, visit: true } },
      monthlyPlan: true,
    },
  });

  if (!route) notFound();

  // Carteira completa como contexto do mapa: sem isso a rota do dia flutua no
  // vazio e o usuario perde a nocao de onde ela esta na cidade.
  const context = await prisma.clinic.findMany({
    where: {
      organizationId: user.organizationId,
      active: true,
      latitude: { not: null },
      longitude: { not: null },
    },
    select: { latitude: true, longitude: true },
    take: 600,
  });

  const breakdown = (route.scoreBreakdown ?? {}) as {
    backtracking?: number;
    concentrationMeters?: number;
    detourMeters?: number;
  };

  const serialized: SerializedRoute = {
    id: route.id,
    date,
    regionLabel: route.regionLabel,
    totalVisits: route.totalVisits,
    totalStops: route.totalStops,
    totalDistanceMeters: route.totalDistanceMeters,
    totalDurationSeconds: route.totalDurationSeconds,
    score: route.score,
    estimated: route.matrixProvider === 'offline-geometric',
    aiSummary: route.aiSummary,
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
  };

  return (
    <>
      <Topbar
        title={formatDateLong(date)}
        subtitle={route.regionLabel ?? undefined}
        estimated={serialized.estimated}
        actions={
          <Link
            href="/agenda"
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <ChevronLeft className="size-3.5" />
            Agenda
          </Link>
        }
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <DayWorkspace
          route={serialized}
          context={context.map((c) => ({ lat: c.latitude!, lng: c.longitude! }))}
          scoreBreakdown={breakdown}
          browserMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ''}
        />
      </main>
    </>
  );
}
