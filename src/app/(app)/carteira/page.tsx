import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Topbar } from '@/components/layout/topbar';
import { ClinicsWorkspace } from './clinics-workspace';

export const metadata = { title: 'Carteira' };
export const dynamic = 'force-dynamic';

export default async function ClinicsPage() {
  const user = await requireUser();

  const [clinics, counts, nextVisits] = await Promise.all([
    prisma.clinic.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: 'asc' },
      take: 1000,
    }),
    prisma.clinic.groupBy({
      by: ['category'],
      where: { organizationId: user.organizationId, active: true },
      _count: true,
    }),
    prisma.visit.findMany({
      where: { userId: user.id, status: 'PLANNED', date: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
      orderBy: { date: 'asc' },
      select: { clinicId: true, date: true },
    }),
  ]);

  // Proxima visita por clinica: a primeira futura de cada uma.
  const nextByClinic = new Map<string, string>();
  for (const visit of nextVisits) {
    if (!nextByClinic.has(visit.clinicId)) {
      nextByClinic.set(visit.clinicId, visit.date.toISOString().slice(0, 10));
    }
  }

  return (
    <>
      <Topbar
        title="Carteira"
        subtitle={`${clinics.filter((c) => c.active).length} clínicas ativas`}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ClinicsWorkspace
          clinics={clinics.map((c) => ({
            id: c.id,
            name: c.name,
            category: c.category,
            neighborhood: c.neighborhood,
            city: c.city,
            address: c.address,
            phone: c.phone,
            active: c.active,
            latitude: c.latitude,
            longitude: c.longitude,
            veterinarians: c.veterinarians,
            visitSplits: c.visitSplits,
            geocodeStatus: c.geocodeStatus,
            lastVisitedAt: c.lastVisitedAt?.toISOString() ?? null,
            nextVisitDate: nextByClinic.get(c.id) ?? null,
          }))}
          counts={Object.fromEntries(counts.map((c) => [c.category, c._count]))}
        />
      </main>
    </>
  );
}
