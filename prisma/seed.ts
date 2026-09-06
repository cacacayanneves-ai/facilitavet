/**
 * Seed do Facilita Vet (secoes 64 e 65).
 *
 * Objetivo: ao abrir o sistema pela primeira vez o usuario NAO ve telas
 * vazias. Ele ve uma carteira real, um mes planejado, um calendario cheio,
 * indicadores com numero e um dia de hoje com visitas — algumas ja concluidas,
 * para que o historico tambem tenha conteudo.
 */
import { PrismaClient, type Category } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_SCORE_WEIGHTS,
} from '../src/lib/route-planner';
import { DEMO_HOME, DEMO_OFFICE, generateDemoClinics } from '../src/lib/demo/sao-paulo';
import { brazilianHolidays, saoPauloHolidays } from '../src/lib/services/holidays';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@facilitavet.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'facilitavet';

async function main() {
  console.log('🌱 Populando o Facilita Vet...\n');

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
  console.log(`  ✓ Usuario ${user.email}`);

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
      monthlyTarget: 100,
      minVisitsPerDay: 4,
      maxVisitsPerDay: 9,
      // As regras comerciais vao para o banco como JSON: o administrador pode
      // mudar frequencia, quantidades e o rodizio sem migracao nem deploy.
      categoryRules: {
        ...DEFAULT_CATEGORY_RULES,
        rules: {
          CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
          CAT2: { frequency: 'alternating', targetCount: 20, enabled: true },
          CAT3: { frequency: 'alternating', targetCount: 20, enabled: true },
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
  console.log('  ✓ Configuracoes');

  // ---------------------------------------------------------------------
  // Feriados: ano corrente e proximo
  // ---------------------------------------------------------------------
  const year = new Date().getUTCFullYear();
  const holidays = [
    ...brazilianHolidays(year),
    ...brazilianHolidays(year + 1),
    ...saoPauloHolidays(year),
    ...saoPauloHolidays(year + 1),
  ];

  for (const holiday of holidays) {
    await prisma.holiday.upsert({
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
    });
  }
  console.log(`  ✓ ${holidays.length} feriados`);

  // ---------------------------------------------------------------------
  // Carteira: 130 clinicas (80 Cat1 + 25 Cat2 + 25 Cat3)
  //
  // Por que 25 e nao 10 em cada categoria alternada: a meta mensal da demo e
  // 100 visitas = 80 Cat1 + 20 da categoria alternada do mes. Com apenas 10
  // clinicas Cat2 o motor avisaria (corretamente) que a carteira nao comporta
  // a meta, e a demo abriria com um alerta em vez de um mes planejado.
  // ---------------------------------------------------------------------
  const existingClinics = await prisma.clinic.count({ where: { organizationId: organization.id } });
  if (existingClinics === 0) {
    const clinics = generateDemoClinics({ cat1: 80, cat2: 25, cat3: 25 });
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
        geocodeStatus: 'RESOLVED',
        geocodeLabel: `${c.address} — ${c.neighborhood}, ${c.city}/${c.state}`,
        geocodedAt: new Date(),
        active: true,
        metadata: { zone: c.zone },
      })),
      skipDuplicates: true,
    });
    console.log(`  ✓ ${clinics.length} clinicas`);

    // Historico plausivel: metade da carteira ja foi visitada no mes passado.
    const created = await prisma.clinic.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    for (let i = 0; i < created.length; i += 2) {
      const date = new Date(
        Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1 + ((i * 3) % 26)),
      );
      await prisma.clinic.update({ where: { id: created[i].id }, data: { lastVisitedAt: date } });
    }
    console.log('  ✓ Historico de visitas anteriores');
  } else {
    console.log(`  • ${existingClinics} clinicas ja existentes (mantidas)`);
  }

  console.log('\n✅ Seed concluido.');
  console.log(`   Login: ${DEMO_EMAIL}`);
  console.log(`   Senha: ${DEMO_PASSWORD}`);
  console.log('\n   Rode "npm run demo:plan" para gerar o mes planejado da demo.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
