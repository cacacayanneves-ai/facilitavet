import { PrismaClient, type Category } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_CATEGORY_RULES, DEFAULT_SCORE_WEIGHTS } from '@/lib/route-planner';
import { DEMO_HOME, DEMO_OFFICE, generateDemoClinics } from '@/lib/demo/sao-paulo';
import { brazilianHolidays, saoPauloHolidays } from '@/lib/services/holidays';

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@facilitavet.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'facilitavet';

/**
 * Popula a organizacao de demonstracao (secoes 64 e 65).
 *
 * Chamado por `prisma/seed.ts`. Ja foi exposto tambem como rota HTTP, para
 * popular um banco que o ambiente de build nao alcancava; a rota saiu depois
 * de cumprir o papel, mas a logica fica aqui — separada do script de CLI —
 * porque esse cenario tende a se repetir a cada ambiente novo.
 */
export async function seedDemoData(prisma: PrismaClient) {
  const organization = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Distribuidora VetLine', slug: 'demo' },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 11);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: {
      organizationId: organization.id,
      name: 'Rafael Nogueira',
      email: DEMO_EMAIL,
      phone: '(11) 98888-7766',
      company: 'Distribuidora VetLine',
      passwordHash,
      role: 'OWNER',
    },
  });

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      workDays: [1, 2, 3, 4, 5],
      workStartTime: '08:00',
      workEndTime: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:30',
      visitDurationMinutes: 30,
      bufferMinutes: 5,
      originType: 'HOME',
      originAddress: DEMO_HOME.address,
      originLatitude: DEMO_HOME.lat,
      originLongitude: DEMO_HOME.lng,
      destinationType: 'NONE',
      destinationAddress: DEMO_OFFICE.address,
      destinationLatitude: DEMO_OFFICE.lat,
      destinationLongitude: DEMO_OFFICE.lng,
      // Meta em VISITAS (veterinarios), nao em clinicas: 160 visitas/mes e o
      // exemplo real do produto — Cat 1 (80) + uma categoria alternada (80).
      monthlyTarget: 160,
      minVisitsPerDay: 6,
      maxVisitsPerDay: 14,
      categoryRules: {
        ...DEFAULT_CATEGORY_RULES,
        rules: {
          CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
          CAT2: { frequency: 'alternating', targetCount: 80, enabled: true },
          CAT3: { frequency: 'alternating', targetCount: 80, enabled: true },
        },
      },
      scoreWeights: { ...DEFAULT_SCORE_WEIGHTS },
      country: 'BR',
      state: 'SP',
      city: 'Sao Paulo',
      whatsappEnabled: true,
      whatsappNumber: '5511988887766',
      whatsappTime: '08:00',
      whatsappDays: [1, 2, 3, 4, 5],
    },
  });

  const year = new Date().getUTCFullYear();
  const holidays = [
    ...brazilianHolidays(year),
    ...brazilianHolidays(year + 1),
    ...saoPauloHolidays(year),
    ...saoPauloHolidays(year + 1),
  ];

  await prisma.$transaction(
    holidays.map((holiday) =>
      prisma.holiday.upsert({
        where: {
          date_country_state_city_name: {
            date: new Date(`${holiday.date}T00:00:00.000Z`),
            country: holiday.country,
            state: holiday.state ?? '',
            city: holiday.city ?? '',
            name: holiday.name,
          },
        },
        update: {},
        create: {
          date: new Date(`${holiday.date}T00:00:00.000Z`),
          name: holiday.name,
          country: holiday.country,
          state: holiday.state ?? '',
          city: holiday.city ?? '',
        },
      }),
    ),
  );

  const existingClinics = await prisma.clinic.count({ where: { organizationId: organization.id } });
  let clinicsCreated = 0;
  if (existingClinics === 0) {
    const clinics = generateDemoClinics({ cat1: 80, cat2: 60, cat3: 60 });
    await prisma.clinic.createMany({
      data: clinics.map((c) => ({
        organizationId: organization.id,
        name: c.name,
        category: c.category as Category,
        address: c.address,
        neighborhood: c.neighborhood,
        city: c.city,
        state: c.state,
        postalCode: c.postalCode,
        phone: c.phone,
        latitude: c.latitude,
        longitude: c.longitude,
        veterinarians: c.veterinarians,
        visitSplits: c.visitSplits,
        geocodeStatus: 'RESOLVED',
        geocodeLabel: `${c.address} — ${c.neighborhood}, ${c.city}/${c.state}`,
        geocodedAt: new Date(),
        active: true,
        metadata: { zone: c.zone },
      })),
      skipDuplicates: true,
    });
    clinicsCreated = clinics.length;

    // Historico plausivel: metade da carteira ja foi visitada no mes passado.
    const created = await prisma.clinic.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    await prisma.$transaction(
      created
        .filter((_, i) => i % 2 === 0)
        .map((clinic, i) =>
          prisma.clinic.update({
            where: { id: clinic.id },
            data: {
              lastVisitedAt: new Date(
                Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1 + ((i * 2 * 3) % 26)),
              ),
            },
          }),
        ),
    );
  }

  return {
    organizationId: organization.id,
    userEmail: user.email,
    holidaysCreated: holidays.length,
    clinicsCreated,
    existingClinics,
  };
}
