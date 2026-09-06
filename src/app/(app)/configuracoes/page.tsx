import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Topbar } from '@/components/layout/topbar';
import { parseCategoryRules, parseScoreWeights } from '@/lib/services/settings';
import { SettingsWorkspace } from './settings-workspace';

export const metadata = { title: 'Configurações' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const settings = user.settings!;

  const [counts, lastMessages, providerStatus] = await Promise.all([
    prisma.clinic.groupBy({
      by: ['category'],
      where: { organizationId: user.organizationId, active: true },
      _count: true,
    }),
    prisma.outboxMessage.findMany({
      where: { userId: user.id },
      orderBy: { scheduledFor: 'desc' },
      take: 5,
    }),
    Promise.resolve({
      maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CLAUDE_ENABLED !== 'false',
      whatsapp: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN),
    }),
  ]);

  return (
    <>
      <Topbar title="Configurações" subtitle="Perfil, jornada, regras comerciais e notificações" />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <SettingsWorkspace
          profile={{ name: user.name, email: user.email, phone: user.phone, company: user.company }}
          settings={{
            workDays: settings.workDays,
            workStartTime: settings.workStartTime,
            workEndTime: settings.workEndTime,
            lunchStart: settings.lunchStart,
            lunchEnd: settings.lunchEnd,
            visitDurationMinutes: settings.visitDurationMinutes,
            minutesPerExtraVeterinarian: settings.minutesPerExtraVeterinarian,
            bufferMinutes: settings.bufferMinutes,
            minDaysBetweenSplitVisits: settings.minDaysBetweenSplitVisits,
            originType: settings.originType,
            originAddress: settings.originAddress,
            originLatitude: settings.originLatitude,
            originLongitude: settings.originLongitude,
            destinationType: settings.destinationType,
            destinationAddress: settings.destinationAddress,
            destinationLatitude: settings.destinationLatitude,
            destinationLongitude: settings.destinationLongitude,
            monthlyTarget: settings.monthlyTarget,
            minVisitsPerDay: settings.minVisitsPerDay,
            maxVisitsPerDay: settings.maxVisitsPerDay,
            country: settings.country,
            state: settings.state,
            city: settings.city,
            whatsappEnabled: settings.whatsappEnabled,
            whatsappNumber: settings.whatsappNumber,
            whatsappTime: settings.whatsappTime,
            whatsappDays: settings.whatsappDays,
            whatsappIncludeRoute: settings.whatsappIncludeRoute,
            whatsappIncludeDistance: settings.whatsappIncludeDistance,
            whatsappIncludeTimes: settings.whatsappIncludeTimes,
            whatsappIncludeMapLink: settings.whatsappIncludeMapLink,
          }}
          categoryRules={parseCategoryRules(settings.categoryRules)}
          scoreWeights={parseScoreWeights(settings.scoreWeights)}
          clinicCounts={Object.fromEntries(counts.map((c) => [c.category, c._count]))}
          providerStatus={providerStatus}
          recentMessages={lastMessages.map((m) => ({
            id: m.id,
            status: m.status,
            scheduledFor: m.scheduledFor.toISOString(),
            sentAt: m.sentAt?.toISOString() ?? null,
            error: m.error,
            body: m.body,
          }))}
        />
      </main>
    </>
  );
}
