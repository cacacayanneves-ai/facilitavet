import type { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { DEFAULT_CATEGORY_RULES, DEFAULT_SCORE_WEIGHTS } from '@/lib/route-planner';
import { brazilianHolidays, saoPauloHolidays } from '@/lib/services/holidays';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Feriados do ano corrente e do proximo.
 *
 * Ficam sem organizationId de proposito: sao datas do calendario civil, iguais
 * para todo mundo. O indice unico (data + pais + estado + cidade + nome) faz o
 * upsert ser idempotente, entao chamar isso a cada cadastro nao duplica nada.
 */
export async function ensureHolidays(db: Db, year = new Date().getUTCFullYear()) {
  const entries = [
    ...brazilianHolidays(year),
    ...brazilianHolidays(year + 1),
    ...saoPauloHolidays(year),
    ...saoPauloHolidays(year + 1),
  ];

  for (const holiday of entries) {
    await db.holiday.upsert({
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

  return entries.length;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || 'equipe';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const taken = await db.organization.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}

export class EmailTakenError extends Error {
  constructor() {
    super('Já existe uma conta com esse e-mail.');
    this.name = 'EmailTakenError';
  }
}

/**
 * Cria uma conta nova: organizacao + usuario dono + configuracoes padrao.
 *
 * A carteira nasce vazia de proposito — quem se cadastra importa a propria
 * planilha em Carteira › Importar. Popular com dados ficticios aqui deixaria
 * o usuario sem saber o que e dele e o que e exemplo.
 */
export async function createAccount(
  db: PrismaClient,
  input: { name: string; email: string; password: string; company?: string | null; phone?: string | null },
) {
  const email = input.email.trim().toLowerCase();

  if (await db.user.findUnique({ where: { email } })) throw new EmailTakenError();

  const passwordHash = await hashPassword(input.password);
  const organizationName = input.company?.trim() || input.name.trim();
  const slug = await uniqueSlug(db, organizationName);

  const user = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: organizationName, slug },
    });

    const created = await tx.user.create({
      data: {
        organizationId: organization.id,
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        company: input.company?.trim() || null,
        passwordHash,
        role: 'OWNER',
      },
    });

    await tx.userSettings.create({
      data: {
        userId: created.id,
        // As interfaces do planner nao tem index signature, entao nao casam
        // estruturalmente com o tipo JSON do Prisma — o cast e so de forma.
        categoryRules: DEFAULT_CATEGORY_RULES as unknown as Prisma.InputJsonObject,
        scoreWeights: DEFAULT_SCORE_WEIGHTS as unknown as Prisma.InputJsonObject,
      },
    });

    return created;
  });

  // Fora da transacao: o cadastro nao pode falhar por causa do calendario,
  // que e complementar e reaproveitado por todas as organizacoes.
  await ensureHolidays(db).catch(() => undefined);

  return user;
}
