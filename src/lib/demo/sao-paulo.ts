/**
 * Gerador de carteira ficticia com distribuicao geografica REALISTA.
 *
 * Nao adianta espalhar 100 pontos aleatorios num retangulo: isso nao testa
 * roteirizacao, porque nao existe regiao densa nem regiao esparsa. Aqui as
 * clinicas nascem em torno de centros de bairro reais de Sao Paulo, com
 * dispersao por bairro, que e como uma carteira comercial de verdade se
 * comporta.
 */

export interface DemoNeighborhood {
  name: string;
  zone: string;
  lat: number;
  lng: number;
  /** Dispersao em graus (~0.01 = ~1,1 km). */
  spread: number;
  weight: number;
}

export const SAO_PAULO_NEIGHBORHOODS: DemoNeighborhood[] = [
  { name: 'Vila Mariana', zone: 'Zona Sul', lat: -23.5893, lng: -46.6345, spread: 0.011, weight: 12 },
  { name: 'Saude', zone: 'Zona Sul', lat: -23.6182, lng: -46.6386, spread: 0.010, weight: 9 },
  { name: 'Moema', zone: 'Zona Sul', lat: -23.6013, lng: -46.6656, spread: 0.010, weight: 9 },
  { name: 'Santo Amaro', zone: 'Zona Sul', lat: -23.6527, lng: -46.7076, spread: 0.013, weight: 8 },
  { name: 'Ipiranga', zone: 'Zona Sudeste', lat: -23.5916, lng: -46.6100, spread: 0.011, weight: 7 },
  { name: 'Mooca', zone: 'Zona Leste', lat: -23.5537, lng: -46.5978, spread: 0.010, weight: 7 },
  { name: 'Tatuape', zone: 'Zona Leste', lat: -23.5404, lng: -46.5765, spread: 0.011, weight: 7 },
  { name: 'Penha', zone: 'Zona Leste', lat: -23.5265, lng: -46.5427, spread: 0.012, weight: 6 },
  { name: 'Santana', zone: 'Zona Norte', lat: -23.5024, lng: -46.6248, spread: 0.011, weight: 7 },
  { name: 'Tucuruvi', zone: 'Zona Norte', lat: -23.4770, lng: -46.6027, spread: 0.011, weight: 5 },
  { name: 'Casa Verde', zone: 'Zona Norte', lat: -23.5093, lng: -46.6614, spread: 0.010, weight: 5 },
  { name: 'Pinheiros', zone: 'Zona Oeste', lat: -23.5629, lng: -46.6944, spread: 0.010, weight: 9 },
  { name: 'Lapa', zone: 'Zona Oeste', lat: -23.5280, lng: -46.7040, spread: 0.011, weight: 7 },
  { name: 'Butanta', zone: 'Zona Oeste', lat: -23.5713, lng: -46.7200, spread: 0.012, weight: 6 },
  { name: 'Perdizes', zone: 'Zona Oeste', lat: -23.5378, lng: -46.6780, spread: 0.009, weight: 6 },
  { name: 'Bela Vista', zone: 'Centro', lat: -23.5595, lng: -46.6440, spread: 0.008, weight: 6 },
  { name: 'Santa Cecilia', zone: 'Centro', lat: -23.5378, lng: -46.6560, spread: 0.008, weight: 5 },
  { name: 'Tremembe', zone: 'Zona Norte', lat: -23.4593, lng: -46.6003, spread: 0.013, weight: 4 },
  { name: 'Sao Mateus', zone: 'Zona Leste', lat: -23.6003, lng: -46.4763, spread: 0.014, weight: 4 },
  { name: 'Campo Limpo', zone: 'Zona Sul', lat: -23.6483, lng: -46.7590, spread: 0.013, weight: 5 },
];

const PREFIXES = [
  'Clinica Veterinaria',
  'Hospital Veterinario',
  'Centro Veterinario',
  'Pet Center',
  'Clinica Pet',
  'Vet Care',
  'Animal Care',
  'Policlinica Veterinaria',
];

const NAMES = [
  'Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta', 'Sigma', 'Omega', 'Aurora', 'Bandeirantes',
  'Pantanal', 'Amazonia', 'Atlantica', 'Ipe', 'Jacaranda', 'Aroeira', 'Cambui', 'Perola', 'Horizonte',
  'Primavera', 'Serrana', 'Boa Vista', 'Sao Jorge', 'Santa Clara', 'Bom Pastor', 'Vida Animal',
  'Amigo Fiel', 'Quatro Patas', 'Nobre', 'Vitalis', 'Anima', 'Zoo Vida', 'Pet Vida', 'Sao Francisco',
  'Bicho Feliz', 'Vet Mais', 'Care Plus', 'Bem Estar', 'Reviver', 'Integrar', 'Mundo Animal',
  'Companheiro', 'Guardiao', 'Estrela', 'Cristal', 'Diamante', 'Esmeralda', 'Safira', 'Rubi', 'Opala',
];

export interface DemoClinicSeed {
  name: string;
  category: 'CAT1' | 'CAT2' | 'CAT3';
  neighborhood: string;
  zone: string;
  city: string;
  state: string;
  address: string;
  postalCode: string;
  phone: string;
  latitude: number;
  longitude: number;
}

/** PRNG deterministico para que a demo seja sempre a mesma. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoClinics(
  options: { total?: number; cat1?: number; cat2?: number; cat3?: number; seed?: number } = {},
): DemoClinicSeed[] {
  const cat1 = options.cat1 ?? 80;
  const cat2 = options.cat2 ?? 10;
  const cat3 = options.cat3 ?? 10;
  const total = options.total ?? cat1 + cat2 + cat3;
  const rng = mulberry32(options.seed ?? 424242);

  const weighted: DemoNeighborhood[] = [];
  for (const n of SAO_PAULO_NEIGHBORHOODS) {
    for (let i = 0; i < n.weight; i += 1) weighted.push(n);
  }

  const categories: Array<'CAT1' | 'CAT2' | 'CAT3'> = [
    ...Array<'CAT1'>(cat1).fill('CAT1'),
    ...Array<'CAT2'>(cat2).fill('CAT2'),
    ...Array<'CAT3'>(cat3).fill('CAT3'),
  ].slice(0, total);

  const used = new Set<string>();
  const clinics: DemoClinicSeed[] = [];

  for (let i = 0; i < categories.length; i += 1) {
    const hood = weighted[Math.floor(rng() * weighted.length)];

    let name = '';
    let guard = 0;
    do {
      const prefix = PREFIXES[Math.floor(rng() * PREFIXES.length)];
      const suffix = NAMES[Math.floor(rng() * NAMES.length)];
      name = `${prefix} ${suffix}`;
      guard += 1;
    } while (used.has(`${name}|${hood.name}`) && guard < 200);
    used.add(`${name}|${hood.name}`);

    // Dispersao gaussiana (Box-Muller) em torno do centro do bairro.
    const [gx, gy] = gaussianPair(rng);
    const latitude = Number((hood.lat + gy * hood.spread).toFixed(6));
    const longitude = Number((hood.lng + gx * hood.spread).toFixed(6));

    clinics.push({
      name,
      category: categories[i],
      neighborhood: hood.name,
      zone: hood.zone,
      city: 'Sao Paulo',
      state: 'SP',
      address: `Rua ${NAMES[Math.floor(rng() * NAMES.length)]}, ${100 + Math.floor(rng() * 1800)}`,
      postalCode: `0${1 + Math.floor(rng() * 8)}${String(Math.floor(rng() * 1000)).padStart(3, '0')}-${String(Math.floor(rng() * 1000)).padStart(3, '0')}`,
      phone: `(11) 9${String(Math.floor(rng() * 10000)).padStart(4, '0')}-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`,
      latitude,
      longitude,
    });
  }

  return clinics;
}

function gaussianPair(rng: () => number): [number, number] {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

/** Endereco de casa/escritorio da demo. */
export const DEMO_HOME = {
  label: 'Casa — Vila Mariana',
  address: 'Rua Domingos de Morais, 1200 — Vila Mariana, Sao Paulo/SP',
  lat: -23.5975,
  lng: -46.6386,
};

export const DEMO_OFFICE = {
  label: 'Escritorio — Pinheiros',
  address: 'Av. Faria Lima, 1500 — Pinheiros, Sao Paulo/SP',
  lat: -23.5760,
  lng: -46.6890,
};
