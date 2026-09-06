import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { seedDemoData } from '@/lib/services/seed-demo';

/**
 * Popula a organizacao de demonstracao a partir do runtime da app.
 *
 * Existe porque nem todo ambiente de build/CI alcanca o banco diretamente
 * (ex.: Neon atras de rede corporativa restrita) — o runtime da propria
 * aplicacao ja fala com o banco normalmente, entao rodamos o seed por aqui,
 * protegido pelo mesmo segredo dos jobs de cron. Chame uma vez apos o
 * primeiro deploy e depois pode remover esta rota.
 *
 * Diferente das rotas de produto, o erro volta cru: quem chega aqui ja tem o
 * segredo em maos e precisa do detalhe para diagnosticar a conexao.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await seedDemoData(prisma)) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: (error as { code?: string })?.code ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
