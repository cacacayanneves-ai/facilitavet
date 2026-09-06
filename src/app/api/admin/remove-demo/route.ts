import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Remove a organizacao de demonstracao e tudo que pende dela.
 *
 * Existe porque o ambiente de desenvolvimento nao alcanca o banco de producao,
 * e o runtime da aplicacao alcanca. E de proposito uma rota de proposito unico
 * (slug fixo, nenhum SQL vindo de fora) e temporaria: some assim que a demo
 * for apagada.
 *
 * A trava importante: recusa se nao houver outra conta com usuario. Melhor
 * falhar do que deixar alguem sem nenhum acesso ao proprio sistema.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DEMO_SLUG = 'demo';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const demo = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (!demo) {
    return NextResponse.json({ ok: true, alreadyRemoved: true });
  }

  const survivors = await prisma.organization.findMany({
    where: { slug: { not: DEMO_SLUG }, users: { some: {} } },
    select: { slug: true, name: true, _count: { select: { users: true } } },
  });

  if (survivors.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Nenhuma outra conta com usuário foi encontrada. Crie a sua em /cadastro antes de remover a demo.',
      },
      { status: 409 },
    );
  }

  const removed = {
    clinics: await prisma.clinic.count({ where: { organizationId: demo.id } }),
    users: await prisma.user.count({ where: { organizationId: demo.id } }),
    plans: await prisma.monthlyPlan.count({ where: { organizationId: demo.id } }),
  };

  await prisma.organization.delete({ where: { id: demo.id } });

  return NextResponse.json({
    ok: true,
    removedOrganization: demo.name,
    removed,
    remainingAccounts: survivors.map((s) => ({
      name: s.name,
      slug: s.slug,
      users: s._count.users,
    })),
  });
}
