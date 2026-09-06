/**
 * Gera uma rota de demonstracao direto no terminal, sem banco e sem UI.
 * Serve para inspecionar a qualidade do motor de planejamento isoladamente.
 *
 *   npm run demo:route
 *   npm run demo:route -- --month 10 --year 2026 --target 100 --days 17
 */
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_PREFERENCES,
  generatePlan,
  type AvailableDay,
  type PlannerClinic,
} from '../src/lib/route-planner';
import { DEMO_HOME, generateDemoClinics } from '../src/lib/demo/sao-paulo';

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1], 10);
  return Number.isFinite(value) ? value : fallback;
}

const month = arg('month', 9);
const year = arg('year', 2026);
const target = arg('target', 160);
const maxDays = arg('days', 0);

function workingDays(y: number, m: number, limit: number): AvailableDay[] {
  const days: AvailableDay[] = [];
  const cursor = new Date(Date.UTC(y, m - 1, 1));
  while (cursor.getUTCMonth() === m - 1) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      days.push({ date: cursor.toISOString().slice(0, 10), weekday });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return limit > 0 ? days.slice(0, limit) : days;
}

const clinics: PlannerClinic[] = generateDemoClinics({ cat1: 80, cat2: 60, cat3: 60 }).map((c, i) => ({
  id: `demo-${i}`,
  name: c.name,
  category: c.category,
  neighborhood: c.neighborhood,
  city: c.city,
  lat: c.latitude,
  lng: c.longitude,
  veterinarians: c.veterinarians,
  visitSplits: c.visitSplits,
}));

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const hm = (s: number) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

async function main() {
  const days = workingDays(year, month, maxDays);
  const started = Date.now();

  const result = await generatePlan(
    {
      clinics,
      availableDays: days,
      monthlyTarget: target,
      month,
      year,
      origin: { label: DEMO_HOME.label, lat: DEMO_HOME.lat, lng: DEMO_HOME.lng },
      destination: null,
      categoryRules: {
        ...DEFAULT_CATEGORY_RULES,
        rules: {
          CAT1: { frequency: 'monthly', targetCount: 80, enabled: true },
          CAT2: { frequency: 'alternating', targetCount: 80, enabled: true },
          CAT3: { frequency: 'alternating', targetCount: 80, enabled: true },
        },
      },
      preferences: DEFAULT_PREFERENCES,
    },
    { onProgress: (e) => console.log(`  [${e.elapsedMs.toString().padStart(5)}ms] ${e.label}`) },
  );

  const s = result.statistics;
  console.log('\n============================================================');
  console.log(`  FACILITA VET — roteiro de ${String(month).padStart(2, '0')}/${year}`);
  console.log('============================================================');
  console.log(`  Categorias do mes .... ${s.requiredCategories.join(' + ')}`);
  console.log(`  Visitas .............. ${s.selectedVisits} (Cat1 ${s.perCategory.CAT1} / Cat2 ${s.perCategory.CAT2} / Cat3 ${s.perCategory.CAT3})`);
  console.log(`  Clinicas (paradas) ... ${s.selectedStops} (Cat1 ${s.perCategoryStops.CAT1} / Cat2 ${s.perCategoryStops.CAT2} / Cat3 ${s.perCategoryStops.CAT3})`);
  console.log(`  Dias planejados ...... ${s.plannedDays} de ${days.length}`);
  console.log(`  Media diaria ......... ${s.averageVisitsPerDay} visitas / ${s.averageStopsPerDay} clinicas`);
  console.log(`  Distancia estimada ... ${km(s.totalDistanceMeters)}`);
  console.log(`  Deslocamento ......... ${hm(s.totalDurationSeconds)}`);
  console.log(`  Score medio .......... ${s.averageScore}/100`);
  console.log(`  Estrategia vencedora . ${s.strategy}`);
  console.log(`  Provider da matriz ... ${s.matrixProvider} (${s.matrixElements} elementos)`);
  if (s.baseline) {
    console.log(`  Linha de base ........ ${km(s.baseline.totalDistanceMeters)} / ${hm(s.baseline.totalDurationSeconds)}`);
    console.log(`  Reducao estimada ..... ${s.baseline.distanceSavingPercent}% de deslocamento`);
  }
  console.log(`  Tempo de calculo ..... ${Date.now() - started}ms`);

  console.log('\n  Candidatas avaliadas:');
  for (const c of s.candidates) {
    console.log(`    ${c.strategy.padEnd(22)} score ${String(c.averageScore).padStart(5)}  ${km(c.totalDistanceMeters).padStart(9)}  ${hm(c.totalDurationSeconds)}`);
  }

  console.log('\n  Agenda:');
  for (const route of result.routes) {
    console.log(
      `    ${route.date}  ${String(route.totalVisits).padStart(2)} visitas em ${String(route.totalStops).padStart(2)} clínicas  ${km(route.totalDistanceMeters).padStart(9)}  ${hm(route.totalDurationSeconds)}  score ${String(route.score).padStart(5)}  ${route.regionLabel}`,
    );
  }

  const sample = result.routes[0];
  console.log(`\n  Detalhe de ${sample.date} (${sample.regionLabel}):`);
  for (const stop of sample.stops) {
    console.log(
      `    ${stop.sequence}. ${stop.estimatedArrival}  ${stop.clinicName.padEnd(34)} ${String(stop.neighborhood).padEnd(16)} ${stop.veterinarians} vet(s)  +${km(stop.distanceFromPreviousMeters)}`,
    );
  }

  if (result.warnings.length) {
    console.log('\n  Avisos:');
    for (const w of result.warnings) console.log(`    [${w.code}] ${w.message}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
