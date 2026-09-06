/**
 * Gera (ou regenera) o plano mensal da demo direto no banco.
 *
 * Roda depois do seed para que a primeira abertura do sistema ja mostre
 * dashboard, calendario, mapa e agenda com conteudo real — e nao telas vazias.
 *
 *   npm run demo:plan            # mes corrente e o proximo
 *   npm run demo:plan -- --month 10 --year 2026
 */
import { prisma } from '../src/lib/db';
import { generateMonthlyPlan } from '../src/lib/services/planning';
import { updateVisitStatus } from '../src/lib/services/visits';

function arg(name: string): number | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = Number.parseInt(process.argv[index + 1], 10);
  return Number.isFinite(value) ? value : null;
}

async function main() {
  const email = process.env.DEMO_EMAIL ?? 'demo@facilitavet.app';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Usuario ${email} nao encontrado. Rode "npm run db:seed" primeiro.`);

  const now = new Date();
  const explicitMonth = arg('month');
  const explicitYear = arg('year');

  const targets = explicitMonth
    ? [{ month: explicitMonth, year: explicitYear ?? now.getUTCFullYear() }]
    : [
        { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() },
        {
          month: now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2,
          year: now.getUTCMonth() + 2 > 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
        },
      ];

  for (const target of targets) {
    process.stdout.write(`\n📅 Planejando ${String(target.month).padStart(2, '0')}/${target.year}... `);
    const outcome = await generateMonthlyPlan({
      userId: user.id,
      year: target.year,
      month: target.month,
      withAnalysis: true,
    });

    const s = outcome.result.statistics;
    if (!outcome.planId) {
      console.log(`inviavel.\n   ${outcome.result.feasibility.message}`);
      continue;
    }

    console.log('ok');
    console.log(`   ${s.selectedVisits} visitas em ${s.plannedDays} dias (${s.requiredCategories.join(' + ')})`);
    console.log(`   ${(s.totalDistanceMeters / 1000).toFixed(0)} km · ${(s.totalDurationSeconds / 3600).toFixed(1)}h · score ${s.averageScore}`);
    if (s.baseline) console.log(`   ${s.baseline.distanceSavingPercent}% menos deslocamento que a linha de base`);
    if (outcome.analysis) console.log(`   Claude: ${outcome.analysis}`);
  }

  // Marca como realizadas as visitas ja passadas do mes corrente, para que o
  // dashboard e o historico abram com progresso real em vez de tudo zerado.
  const today = new Date();
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

  const pastVisits = await prisma.visit.findMany({
    where: { userId: user.id, status: 'PLANNED', date: { gte: startOfMonth, lte: yesterday } },
  });

  let completed = 0;
  for (const visit of pastVisits) {
    // ~85% de cumprimento: uma agenda real tem cancelamento.
    const roll = (visit.sequence * 37 + visit.date.getUTCDate() * 11) % 100;
    await updateVisitStatus({
      visitId: visit.id,
      userId: user.id,
      status: roll < 85 ? 'COMPLETED' : 'CANCELLED',
      reason: roll < 85 ? undefined : 'Clinica fechada no horario',
    });
    if (roll < 85) completed += 1;
  }

  if (pastVisits.length > 0) {
    console.log(`\n✓ ${completed} de ${pastVisits.length} visitas passadas marcadas como realizadas.`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
