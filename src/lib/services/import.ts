import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getMapsProvider } from '@/lib/providers/maps';
import { normalizeKey } from '@/lib/route-planner';

/**
 * IMPORTACAO DA CARTEIRA (secoes 8 a 10).
 *
 * O fluxo e explicitamente em etapas com revisao humana, porque uma planilha
 * comercial real vem suja: colunas com nomes livres, duplicidades, bairro sem
 * cidade, categoria escrita de cinco jeitos. Importar direto para o banco
 * produziria uma carteira silenciosamente errada — e uma carteira errada
 * produz um roteiro errado o ano inteiro.
 *
 *   upload -> deteccao de colunas -> mapeamento -> validacao -> duplicidades
 *          -> geocodificacao -> revisao -> commit
 */

export type CanonicalField =
  | 'name'
  | 'category'
  | 'address'
  | 'neighborhood'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'phone'
  | 'latitude'
  | 'longitude'
  | 'veterinarians'
  | 'visitSplits'
  | 'notes'
  | 'active';

export const CANONICAL_FIELDS: Array<{ field: CanonicalField; label: string; required: boolean }> = [
  { field: 'name', label: 'Nome da clinica', required: true },
  { field: 'category', label: 'Categoria', required: true },
  { field: 'address', label: 'Endereco', required: false },
  { field: 'neighborhood', label: 'Bairro', required: false },
  { field: 'city', label: 'Cidade', required: false },
  { field: 'state', label: 'Estado (UF)', required: false },
  { field: 'postalCode', label: 'CEP', required: false },
  { field: 'phone', label: 'Telefone', required: false },
  { field: 'latitude', label: 'Latitude', required: false },
  { field: 'longitude', label: 'Longitude', required: false },
  // A meta do propagandista conta visitas por veterinario — este numero
  // participa diretamente da matematica do planejamento, nao e so exibicao.
  { field: 'veterinarians', label: 'Quantidade de veterinarios', required: false },
  { field: 'visitSplits', label: 'Dividir visita em quantas partes', required: false },
  { field: 'notes', label: 'Observacoes', required: false },
  { field: 'active', label: 'Ativo', required: false },
];

/** Sinonimos por campo — cobre os cabecalhos que aparecem na pratica. */
const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  name: ['nome', 'clinica', 'nome da clinica', 'razao social', 'estabelecimento', 'cliente', 'nome fantasia'],
  category: ['categoria', 'cat', 'classificacao', 'tipo', 'classe', 'segmento'],
  address: ['endereco', 'logradouro', 'rua', 'endereco completo', 'end'],
  neighborhood: ['bairro', 'regiao', 'distrito', 'zona'],
  city: ['cidade', 'municipio', 'localidade'],
  state: ['estado', 'uf', 'sigla'],
  postalCode: ['cep', 'codigo postal'],
  phone: ['telefone', 'fone', 'celular', 'contato', 'whatsapp', 'tel'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
  veterinarians: [
    'veterinarios', 'qtd veterinarios', 'quantidade de veterinarios', 'numero de veterinarios',
    'nº veterinarios', 'n veterinarios', 'vets', 'qtd vets', 'medicos veterinarios', 'nº vets',
  ],
  visitSplits: [
    'partes', 'dividir visita', 'divisao', 'qtd partes', 'numero de partes', 'visitas divididas', 'split',
  ],
  notes: ['observacoes', 'observacao', 'obs', 'notas', 'comentarios'],
  active: ['ativo', 'ativa', 'status', 'situacao'],
};

export interface ParsedSheet {
  columns: string[];
  rows: Array<Record<string, string>>;
}

/** Le XLSX ou CSV a partir do buffer enviado. */
export async function parseSpreadsheet(filename: string, buffer: Buffer): Promise<ParsedSheet> {
  const isCsv = /\.csv$/i.test(filename);
  return isCsv ? parseCsv(buffer) : parseXlsx(buffer);
}

function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    // Detecta ";" (padrao brasileiro do Excel) alem de ",".
    delimitersToGuess: [',', ';', '\t', '|'],
    transformHeader: (header) => header.trim(),
  });

  const columns = (parsed.meta.fields ?? []).filter(Boolean);
  const rows = parsed.data.map((row) => {
    const clean: Record<string, string> = {};
    for (const column of columns) clean[column] = String(row[column] ?? '').trim();
    return clean;
  });

  return { columns, rows: rows.filter((r) => Object.values(r).some((v) => v.length > 0)) };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { columns: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    columns[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const rows: Array<Record<string, string>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    columns.forEach((column, index) => {
      if (!column) return;
      const cell = row.getCell(index + 1);
      const value = cellToString(cell.value);
      record[column] = value;
      if (value) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return { columns: columns.filter(Boolean), rows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/**
 * Sugere o mapeamento de colunas por similaridade de cabecalho.
 * O usuario SEMPRE confirma antes do commit — a sugestao economiza cliques,
 * nao substitui a decisao.
 */
export function suggestColumnMapping(columns: string[]): Partial<Record<CanonicalField, string>> {
  const mapping: Partial<Record<CanonicalField, string>> = {};
  const used = new Set<string>();

  for (const { field } of CANONICAL_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field];
    let best: { column: string; score: number } | null = null;

    for (const column of columns) {
      if (used.has(column)) continue;
      const normalized = normalizeKey(column);
      let score = 0;
      if (synonyms.includes(normalized)) score = 100;
      else if (synonyms.some((s) => normalized === s.replace(/\s+/g, ''))) score = 95;
      else if (synonyms.some((s) => normalized.includes(s))) score = 70;
      else if (synonyms.some((s) => s.includes(normalized) && normalized.length >= 3)) score = 55;
      if (score > 0 && (!best || score > best.score)) best = { column, score };
    }

    if (best) {
      mapping[field] = best.column;
      used.add(best.column);
    }
  }

  return mapping;
}

export type RowIssue =
  | { level: 'error'; code: 'MISSING_NAME' | 'INVALID_CATEGORY' | 'INVALID_COORDINATES'; message: string }
  | {
      level: 'warning';
      code: 'DUPLICATE_IN_FILE' | 'DUPLICATE_IN_DATABASE' | 'NO_LOCATION_DATA' | 'INVALID_VETERINARIAN_COUNT';
      message: string;
    };

export interface NormalizedRow {
  index: number;
  name: string;
  category: 'CAT1' | 'CAT2' | 'CAT3' | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Numero de veterinarios da clinica — peso da visita no planejamento. */
  veterinarians: number;
  /** Em quantas partes a visita deve ser dividida (1 = nao dividir). */
  visitSplits: number;
  notes: string | null;
  active: boolean;
  issues: RowIssue[];
  geocodeStatus: 'PENDING' | 'RESOLVED' | 'AMBIGUOUS' | 'FAILED' | 'MANUAL';
  geocodeLabel: string | null;
  geocodeCandidates: Array<{ lat: number; lng: number; label: string }>;
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: 'CAT1' | 'CAT2' | 'CAT3' }> = [
  { pattern: /^(cat\s*)?0*1$|^categoria\s*0*1$|^a$/i, category: 'CAT1' },
  { pattern: /^(cat\s*)?0*2$|^categoria\s*0*2$|^b$/i, category: 'CAT2' },
  { pattern: /^(cat\s*)?0*3$|^categoria\s*0*3$|^c$/i, category: 'CAT3' },
];

export function normalizeCategory(raw: string): 'CAT1' | 'CAT2' | 'CAT3' | null {
  const value = raw.trim();
  if (!value) return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(compact)) return category;
  }
  const upper = compact.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'CAT1' || upper === 'CATEGORIA1') return 'CAT1';
  if (upper === 'CAT2' || upper === 'CATEGORIA2') return 'CAT2';
  if (upper === 'CAT3' || upper === 'CATEGORIA3') return 'CAT3';
  return null;
}

/** Normaliza + valida + detecta duplicidades (etapas 6 e 7). */
export async function validateRows(args: {
  rows: Array<Record<string, string>>;
  mapping: Partial<Record<CanonicalField, string>>;
  organizationId: string;
  defaults?: { city?: string | null; state?: string | null };
}): Promise<NormalizedRow[]> {
  const { rows, mapping, organizationId } = args;

  const existing = await prisma.clinic.findMany({
    where: { organizationId },
    select: { name: true, neighborhood: true },
  });
  const existingKeys = new Set(existing.map((c) => `${normalizeKey(c.name)}|${normalizeKey(c.neighborhood ?? '')}`));

  const seenInFile = new Map<string, number>();
  const result: NormalizedRow[] = [];

  rows.forEach((row, index) => {
    const get = (field: CanonicalField): string => {
      const column = mapping[field];
      return column ? (row[column] ?? '').trim() : '';
    };

    const name = get('name');
    const categoryRaw = get('category');
    const category = normalizeCategory(categoryRaw);
    const issues: RowIssue[] = [];

    if (!name) {
      issues.push({ level: 'error', code: 'MISSING_NAME', message: 'Linha sem nome da clínica.' });
    }
    if (!category) {
      issues.push({
        level: 'error',
        code: 'INVALID_CATEGORY',
        message: categoryRaw
          ? `Categoria "${categoryRaw}" não reconhecida. Use Cat 1, Cat 2 ou Cat 3.`
          : 'Categoria não informada.',
      });
    }

    const latitude = parseCoordinate(get('latitude'));
    const longitude = parseCoordinate(get('longitude'));
    if ((latitude === null) !== (longitude === null)) {
      issues.push({
        level: 'error',
        code: 'INVALID_COORDINATES',
        message: 'Latitude e longitude precisam ser informadas juntas.',
      });
    }

    const neighborhood = get('neighborhood') || null;
    const city = get('city') || args.defaults?.city || null;
    const address = get('address') || null;
    const postalCode = get('postalCode') || null;

    if (latitude === null && !address && !postalCode && !neighborhood) {
      issues.push({
        level: 'warning',
        code: 'NO_LOCATION_DATA',
        message: 'Sem endereço, CEP, bairro ou coordenadas: não será possível localizar esta clínica.',
      });
    }

    // A meta do propagandista conta VISITAS POR VETERINARIO — sem esta
    // coluna, cada clinica vale 1 visita (comportamento anterior, ainda
    // valido para quem nao tem essa informacao na planilha).
    const veterinariansRaw = get('veterinarians');
    let veterinarians = 1;
    if (veterinariansRaw) {
      const parsed = Number.parseInt(veterinariansRaw.replace(/\D/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        veterinarians = parsed;
      } else {
        issues.push({
          level: 'warning',
          code: 'INVALID_VETERINARIAN_COUNT',
          message: `Não foi possível interpretar "${veterinariansRaw}" como número de veterinários. Usando 1.`,
        });
      }
    }

    const visitSplitsRaw = get('visitSplits');
    let visitSplits = 1;
    if (visitSplitsRaw) {
      const parsed = Number.parseInt(visitSplitsRaw.replace(/\D/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > 1) visitSplits = parsed;
    }
    if (visitSplits > veterinarians) {
      // Nao da para dividir a visita em mais partes do que ha veterinarios.
      visitSplits = 1;
    }

    const key = `${normalizeKey(name)}|${normalizeKey(neighborhood ?? '')}`;
    if (name) {
      if (seenInFile.has(key)) {
        issues.push({
          level: 'warning',
          code: 'DUPLICATE_IN_FILE',
          message: `Duplicada na planilha (linha ${(seenInFile.get(key) ?? 0) + 2}).`,
        });
      } else {
        seenInFile.set(key, index);
      }
      if (existingKeys.has(key)) {
        issues.push({
          level: 'warning',
          code: 'DUPLICATE_IN_DATABASE',
          message: 'Já existe na carteira. Será atualizada em vez de duplicada.',
        });
      }
    }

    result.push({
      index,
      name,
      category,
      address,
      neighborhood,
      city,
      state: get('state') || args.defaults?.state || null,
      postalCode,
      phone: get('phone') || null,
      latitude,
      longitude,
      veterinarians,
      visitSplits,
      notes: get('notes') || null,
      active: parseActive(get('active')),
      issues,
      geocodeStatus: latitude !== null && longitude !== null ? 'MANUAL' : 'PENDING',
      geocodeLabel: null,
      geocodeCandidates: [],
    });
  });

  return result;
}

/**
 * Geocodificacao das linhas pendentes (etapa 8).
 *
 * Regras de produto (secao 9):
 *  - nunca escolhemos silenciosamente entre resultados ambiguos;
 *  - falha nao vira "ignorar a linha": vira status FAILED visivel na revisao.
 */
export async function geocodeRows(
  rows: NormalizedRow[],
  options: { limit?: number; defaults?: { city?: string | null; state?: string | null } } = {},
): Promise<NormalizedRow[]> {
  const maps = getMapsProvider();
  const limit = options.limit ?? 250;
  let processed = 0;

  for (const row of rows) {
    if (row.geocodeStatus !== 'PENDING') continue;
    if (!row.name && !row.address) continue;
    if (processed >= limit) break;
    processed += 1;

    try {
      const result = await maps.geocode({
        name: row.name,
        address: row.address,
        neighborhood: row.neighborhood,
        city: row.city ?? options.defaults?.city ?? null,
        state: row.state ?? options.defaults?.state ?? null,
        postalCode: row.postalCode,
        country: 'Brasil',
      });

      if (result.status === 'RESOLVED' && result.candidates[0]) {
        row.latitude = result.candidates[0].lat;
        row.longitude = result.candidates[0].lng;
        row.geocodeLabel = result.candidates[0].label;
        row.geocodeStatus = 'RESOLVED';
      } else if (result.status === 'AMBIGUOUS') {
        // Mais de um endereco plausivel: o usuario escolhe na revisao.
        row.geocodeStatus = 'AMBIGUOUS';
        row.geocodeCandidates = result.candidates.map((c) => ({ lat: c.lat, lng: c.lng, label: c.label }));
      } else {
        row.geocodeStatus = 'FAILED';
        row.geocodeLabel = result.reason ?? 'Não foi possível localizar.';
      }
    } catch (error) {
      row.geocodeStatus = 'FAILED';
      row.geocodeLabel = error instanceof Error ? error.message : 'Falha na geocodificação.';
      logger.warn('Falha ao geocodificar linha da importacao', {
        scope: 'import',
        row: row.index,
        error: String(error),
      });
    }
  }

  return rows;
}

export interface CommitSummary {
  created: number;
  updated: number;
  skipped: number;
  withoutLocation: number;
}

/** Grava as linhas validas na carteira (etapa 11). */
export async function commitRows(args: {
  organizationId: string;
  rows: NormalizedRow[];
}): Promise<CommitSummary> {
  const summary: CommitSummary = { created: 0, updated: 0, skipped: 0, withoutLocation: 0 };

  for (const row of args.rows) {
    const blocking = row.issues.filter((i) => i.level === 'error');
    if (blocking.length > 0 || !row.name || !row.category) {
      summary.skipped += 1;
      continue;
    }

    const hasCoordinates = row.latitude !== null && row.longitude !== null;
    if (!hasCoordinates) summary.withoutLocation += 1;

    const geocodeStatus = hasCoordinates
      ? row.geocodeStatus === 'MANUAL'
        ? 'MANUAL'
        : 'RESOLVED'
      : row.geocodeStatus === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : 'FAILED';

    const data = {
      name: row.name,
      category: row.category,
      address: row.address,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      phone: row.phone,
      notes: row.notes,
      latitude: row.latitude,
      longitude: row.longitude,
      veterinarians: row.veterinarians,
      visitSplits: row.visitSplits,
      geocodeStatus,
      geocodeLabel: row.geocodeLabel,
      geocodedAt: hasCoordinates ? new Date() : null,
      active: row.active,
    } as const;

    const existing = await prisma.clinic.findFirst({
      where: {
        organizationId: args.organizationId,
        name: row.name,
        neighborhood: row.neighborhood,
      },
    });

    if (existing) {
      await prisma.clinic.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      await prisma.clinic.create({ data: { ...data, organizationId: args.organizationId } });
      summary.created += 1;
    }
  }

  logger.info('Importacao concluida', { scope: 'import', ...summary });
  return summary;
}

function parseCoordinate(raw: string): number | null {
  if (!raw) return null;
  // Planilhas brasileiras usam virgula decimal.
  const value = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  if (value < -90 || value > 90) {
    // Provavelmente longitude no campo errado; deixamos o validador acusar.
    return Math.abs(value) <= 180 ? value : null;
  }
  return value;
}

function parseActive(raw: string): boolean {
  if (!raw) return true;
  const value = normalizeKey(raw);
  return !['nao', 'n', 'false', '0', 'inativo', 'inativa', 'desativado'].includes(value);
}

export const columnMappingSchema = z.record(
  z.enum([
    'name', 'category', 'address', 'neighborhood', 'city', 'state',
    'postalCode', 'phone', 'latitude', 'longitude', 'notes', 'active',
  ]),
  z.string(),
);
