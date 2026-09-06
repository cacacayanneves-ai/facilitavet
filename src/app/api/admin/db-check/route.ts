import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Diagnostico de conexao com o banco.
 *
 * Mostra para qual host/database a aplicacao esta realmente apontando (sem a
 * senha) e o erro exato de conexao, quando houver. Existe porque depurar isso
 * so pelo log da plataforma e lento demais: aqui a resposta chega no navegador.
 * Protegido pelo mesmo segredo dos jobs de cron.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function describeUrl(raw: string | undefined) {
  if (!raw) return { configured: false };
  try {
    const url = new URL(raw);
    return {
      configured: true,
      host: url.hostname,
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user: url.username,
      params: url.search.replace(/^\?/, ''),
    };
  } catch {
    return { configured: true, unparseable: true };
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const config = {
    DATABASE_URL: describeUrl(process.env.DATABASE_URL),
    DIRECT_URL: describeUrl(process.env.DIRECT_URL),
    region: process.env.VERCEL_REGION ?? null,
  };

  const started = Date.now();
  try {
    const rows = await prisma.$queryRaw<Array<{ db: string; version: string }>>`
      SELECT current_database() AS db, version() AS version
    `;
    const tables = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - started,
      config,
      connectedTo: rows[0]?.db ?? null,
      serverVersion: rows[0]?.version ?? null,
      publicTables: Number(tables[0]?.count ?? 0),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        config,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: (error as { code?: string })?.code ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
