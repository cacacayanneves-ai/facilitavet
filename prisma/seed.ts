/**
 * Seed do Facilita Vet (secoes 64 e 65).
 *
 * Objetivo: ao abrir o sistema pela primeira vez o usuario NAO ve telas
 * vazias. Ele ve uma carteira real, um mes planejado, um calendario cheio,
 * indicadores com numero e um dia de hoje com visitas — algumas ja concluidas,
 * para que o historico tambem tenha conteudo.
 *
 * A logica de populacao mora em src/lib/services/seed-demo.ts, compartilhada
 * com a rota /api/admin/seed (usada quando o ambiente de build nao alcanca
 * o banco diretamente e o seed precisa rodar a partir do runtime da app).
 */
import { PrismaClient } from '@prisma/client';
import { seedDemoData } from '../src/lib/services/seed-demo';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@facilitavet.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'facilitavet';

async function main() {
  console.log('🌱 Populando o Facilita Vet...\n');
  const result = await seedDemoData(prisma);
  console.log(`  ✓ Usuario ${result.userEmail}`);
  console.log('  ✓ Configuracoes');
  console.log(`  ✓ ${result.holidaysCreated} feriados`);
  if (result.clinicsCreated > 0) {
    console.log(`  ✓ ${result.clinicsCreated} clinicas`);
    console.log('  ✓ Historico de visitas anteriores');
  } else {
    console.log(`  • ${result.existingClinics} clinicas ja existentes (mantidas)`);
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
