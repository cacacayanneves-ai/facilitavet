import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { z } from 'zod';
import type { GeocodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getMapsProvider } from '@/lib/providers/maps';
import { normalizeKey } from '@/lib/route-planner';
import { parseFixedDate, parseVisitFrequency } from './visit-frequency';
import { categoryLabel } from '@/lib/utils';

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
  | 'active'
  | 'frequency'
  | 'fixedDate';

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
  { field: 'frequency', label: 'Frequencia de visita', required: false },
  { field: 'fixedDate', label: 'Data marcada', required: false },
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
  frequency: ['frequencia de visita', 'frequencia de visitas', 'frequencia', 'visitas no mes'],
  fixedDate: ['data marcada', 'data da visita', 'data fixa', 'agendar', 'visitei esse mes', 'visitei'],
};

export interface ParsedSheet {
  columns: string[];
  rows: Array<Record<string, string>>;
  /** Avisos do PROCESSO de leitura (ex.: agregação por veterinário), não das linhas. */
  notices: string[];
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

  return {
    columns,
    rows: rows.filter((r) => Object.values(r).some((v) => v.length > 0)),
    notices: [],
  };
}

/** Le uma unica aba no formato "uma linha por clinica" (o formato padrao). */
function readSheetAsRows(sheet: ExcelJS.Worksheet): ParsedSheet {
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

  return { columns: columns.filter(Boolean), rows, notices: [] };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets = workbook.worksheets.filter((s) => s.rowCount > 1);
  if (sheets.length === 0) return { columns: [], rows: [], notices: [] };

  const perVeterinarian = selectPerVeterinarianSheets(sheets);
  if (perVeterinarian) return aggregatePerVeterinarianWorkbook(perVeterinarian.sheets, perVeterinarian.ignored);

  return readSheetAsRows(sheets[0]);
}

/**
 * Formato "uma linha por veterinario, categoria = nome da aba" (secao 8, caso
 * real de cliente).
 *
 * Uma planilha comercial de carteira veterinaria nao chega no formato "uma
 * linha por clinica": chega como lista de escala/cobertura, com uma linha por
 * VETERINARIO — a clinica se repete uma vez por profissional que atende nela.
 * Isso e o dado primario de verdade (quem atende onde), e a contagem de
 * veterinarios por clinica — que e a unidade real de trabalho do planejador —
 * nasce de CONTAR essas linhas, nao de uma coluna numerica que ninguem
 * preencheria a mao para 300+ linhas.
 *
 * Reconhecemos o formato pelas abas que tem coluna de clinica E coluna de
 * veterinario, sem coluna de categoria — a categoria e o nome da aba ("CAT 1"
 * ou, na versao atual da planilha, "FIXOS" / "VARI 1" / "VARI 2"). Quando
 * algumas abas tem nome de categoria e outras nao (uma aba "todos" que copia
 * as demais, uma lista de PDVs, uma aba "NÃO" de quem saiu da carteira), so as
 * de categoria entram — importar a copia consolidada duplicaria todo mundo.
 * Uma unica aba sem nome de categoria tambem vale (reimportacao parcial).
 */
function selectPerVeterinarianSheets(
  sheets: ExcelJS.Worksheet[],
): { sheets: ExcelJS.Worksheet[]; ignored: string[] } | null {
  const candidates = sheets.filter((sheet) => {
    const roles = detectRoles(headerColumns(sheet));
    return roles.clinic && roles.veterinarian && !roles.category;
  });
  if (candidates.length === 0) return null;

  const categorized = candidates.filter((sheet) => normalizeCategory(sheet.name) !== null);
  if (categorized.length > 0) {
    return {
      sheets: categorized,
      ignored: sheets.filter((s) => !categorized.includes(s)).map((s) => s.name),
    };
  }
  // Sem nenhuma aba com nome de categoria: o formato antigo exigia que TODAS
  // as abas fossem de veterinario; mantem esse contrato.
  return candidates.length === sheets.length ? { sheets: candidates, ignored: [] } : null;
}

interface SheetRoles {
  clinic: string | null;
  veterinarian: string | null;
  neighborhood: string | null;
  category: string | null;
  split: string | null;
  address: string | null;
  frequency: string | null;
  schedule: string | null;
}

const CLINIC_SYNONYMS = ['clinica', 'clinicas', 'nome da clinica', 'estabelecimento', 'de onde', 'local de atendimento'];
const VETERINARIAN_SYNONYMS = [
  'nome dos veterinarios', 'nome do veterinario', 'veterinario', 'veterinarios', 'nome veterinario',
];
// "NOME" sozinho so vale como veterinario em casamento exato: por substring
// ele casaria com "Nome da clinica".
const VETERINARIAN_EXACT = ['nome', 'nome completo'];
const CATEGORY_SYNONYMS = ['categoria', 'cat', 'classificacao', 'segmento'];
const NEIGHBORHOOD_SYNONYMS = ['bairro', 'regiao', 'distrito', 'zona'];
// Coluna livre marcando cobertura por plantao — a mesma clinica tem gente
// diferente presente em dias diferentes, entao uma visita nao alcanca todos.
const SPLIT_FLAG_SYNONYMS = ['2 visitas', 'plantao', 'dividir visita', 'split'];
const ADDRESS_SYNONYMS = ['endereco', 'endereco completo', 'logradouro'];
const FREQUENCY_SYNONYMS = ['frequencia de visita', 'frequencia de visitas', 'frequencia', 'visitas no mes'];
// Instrucao de agenda escrita a mao: "colocar dia 16 de outubro".
const SCHEDULE_SYNONYMS = ['visitei esse mes', 'visitei', 'data marcada', 'data da visita', 'data fixa', 'agendar'];

function headerColumns(sheet: ExcelJS.Worksheet): string[] {
  const headerRow = sheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    columns[colNumber - 1] = String(cell.value ?? '').trim();
  });
  return columns.filter(Boolean);
}

function findColumn(columns: string[], synonyms: string[], exclude: Array<string | null> = []): string | null {
  const normalized = columns
    .filter((c) => !exclude.includes(c))
    .map((c) => ({ raw: c, key: normalizeKey(c) }));
  const exact = normalized.find((c) => synonyms.includes(c.key));
  if (exact) return exact.raw;
  const partial = normalized.find((c) => synonyms.some((s) => c.key.includes(s)));
  return partial?.raw ?? null;
}

function detectRoles(columns: string[]): SheetRoles {
  const clinic = findColumn(columns, CLINIC_SYNONYMS);
  const veterinarian =
    findColumn(columns, VETERINARIAN_SYNONYMS, [clinic]) ??
    columns.find((c) => c !== clinic && VETERINARIAN_EXACT.includes(normalizeKey(c))) ??
    null;
  const frequency = findColumn(columns, FREQUENCY_SYNONYMS);
  return {
    clinic,
    veterinarian,
    neighborhood: findColumn(columns, NEIGHBORHOOD_SYNONYMS),
    category: findColumn(columns, CATEGORY_SYNONYMS),
    split: findColumn(columns, SPLIT_FLAG_SYNONYMS, [frequency]),
    address: findColumn(columns, ADDRESS_SYNONYMS),
    frequency,
    schedule: findColumn(columns, SCHEDULE_SYNONYMS),
  };
}

function isTruthyFlag(raw: string): boolean {
  const value = normalizeKey(raw);
  return ['sim', 's', 'x', 'yes', 'y', '1', 'true'].includes(value);
}

/**
 * Agrega linhas de veterinario em linhas de clinica.
 *
 * A chave de agrupamento e (nome, bairro) — nao so o nome. Duas unidades
 * podem ter o mesmo nome comercial em bairros diferentes (rede de clinicas),
 * e sao clinicas fisicamente distintas mesmo com o mesmo nome.
 *
 * Quando a MESMA clinica (nome + bairro) aparece em mais de uma aba —
 * categoria misturada por engano ou por profissionais novos ainda sendo
 * classificados — nao escolhemos uma categoria e descartamos os veterinarios
 * da outra: eles trabalham na mesma clinica de verdade, entao entram na
 * contagem total. A categoria da clinica fica sendo a de maior contagem, e o
 * conflito vira um aviso legivel em vez de sumir silenciosamente.
 *
 * Uma linha pode ter clinica sem veterinario nomeado ainda — area nova, em
 * mapeamento. Essa linha registra a clinica (nao pode sumir da carteira),
 * mas nao conta como veterinario: nao ha ninguem para contar.
 *
 * Endereco: vale o da PRIMEIRA linha da clinica. Ao arrastar a celula para
 * baixo no Google Sheets, o CEP das linhas seguintes e incrementado sozinho
 * (23017-250, -251, -252...) — so a primeira linha e confiavel.
 *
 * Frequencia: a clinica e visitada tantas vezes quanto o veterinario que mais
 * exige; com textos diferentes entre veterinarios, vale o do mais exigente e
 * a diferenca vira aviso.
 */
function aggregatePerVeterinarianWorkbook(sheets: ExcelJS.Worksheet[], ignoredSheets: string[] = []): ParsedSheet {
  interface Group {
    name: string;
    neighborhood: string;
    address: string;
    veterinarians: number;
    split: boolean;
    byCategory: Map<string, number>;
    pendingRows: number;
    frequencies: string[];
    schedules: string[];
    note: string;
  }

  const groups = new Map<string, Group>();
  const unassigned: string[] = [];
  const sheetLabels: string[] = [];
  let hasFrequency = false;

  for (const sheet of sheets) {
    const columns = headerColumns(sheet);
    const roles = detectRoles(columns);
    if (roles.frequency) hasFrequency = true;
    const category = normalizeCategory(sheet.name) ?? sheet.name.trim();
    const label = normalizeCategory(sheet.name);
    sheetLabels.push(`${sheet.name.trim()} → ${label ? categoryLabel(label) : 'categoria não reconhecida'}`);

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cellAt = (column: string | null): string => {
        if (!column) return '';
        const index = columns.indexOf(column);
        return index === -1 ? '' : cellToString(row.getCell(index + 1).value);
      };

      const vetName = cellAt(roles.veterinarian);
      const clinicName = cellAt(roles.clinic);
      if (!vetName && !clinicName) return; // linha em branco

      if (!clinicName) {
        unassigned.push(`${sheet.name.trim()}, linha ${rowNumber}${vetName ? `: ${vetName}` : ''}`);
        return;
      }

      const neighborhood = cellAt(roles.neighborhood);
      const key = `${normalizeKey(clinicName)}|${normalizeKey(neighborhood)}`;
      const group = groups.get(key) ?? {
        name: clinicName,
        neighborhood,
        address: '',
        veterinarians: 0,
        split: false,
        byCategory: new Map<string, number>(),
        pendingRows: 0,
        frequencies: [],
        schedules: [],
        note: '',
      };
      // Garante que a clinica tenha uma categoria mesmo se esta linha nao
      // tiver veterinario nomeado (senao uma clinica so-pendente nao teria
      // categoria nenhuma para desempatar).
      if (!group.byCategory.has(category)) group.byCategory.set(category, 0);
      const addressCell = cellAt(roles.address);
      if (isRouteExclusionNote(addressCell)) {
        if (!group.note) group.note = addressCell;
      } else if (!group.address) {
        group.address = addressCell;
      }

      const frequency = cellAt(roles.frequency);
      if (frequency) group.frequencies.push(frequency);
      const schedule = cellAt(roles.schedule);
      if (schedule && parseFixedDate(schedule)) group.schedules.push(schedule);

      if (vetName) {
        group.veterinarians += 1;
        group.byCategory.set(category, (group.byCategory.get(category) ?? 0) + 1);
        if (isTruthyFlag(cellAt(roles.split))) group.split = true;
      } else {
        group.pendingRows += 1;
      }
      groups.set(key, group);
    });
  }

  const conflicts: string[] = [];
  const pendingClinics: string[] = [];
  const mixedFrequency: string[] = [];
  const outOfMonth: string[] = [];
  const fixedDates: string[] = [];
  const excludedByNote: string[] = [];
  const rows: Array<Record<string, string>> = [];
  let totalNamedVets = 0;

  const label = (group: Group) => `${group.name}${group.neighborhood ? ` (${group.neighborhood})` : ''}`;

  for (const group of groups.values()) {
    // So entram no desempate categorias com veterinario de verdade — uma
    // linha "so clinica" registrada em CAT3 com peso 0 nao e um "conflito"
    // com a CAT1 onde essa clinica de fato tem gente, e nao deve aparecer
    // como se fosse.
    const named = [...group.byCategory.entries()].filter(([, count]) => count > 0);
    const ranked = (named.length > 0 ? named : [...group.byCategory.entries()]).sort((a, b) => b[1] - a[1]);
    const [winningCategory] = ranked[0];

    if (named.length > 1) {
      const detail = named
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => `${categoryLabel(cat)} (${count})`)
        .join(' e ');
      conflicts.push(`${label(group)}: ${detail} — mantida ${categoryLabel(winningCategory)}.`);
    }

    // Clinica so com linhas "sem veterinario nomeado ainda": entra na
    // carteira com 1 visita padrao (o motor sempre conta pelo menos 1 por
    // clinica) em vez de sumir, mas o usuario precisa saber que o numero e
    // um palpite, nao um dado real.
    const veterinarians = group.veterinarians > 0 ? group.veterinarians : 1;
    if (group.veterinarians === 0) pendingClinics.push(label(group));
    totalNamedVets += group.veterinarians;

    let frequency = '';
    if (group.frequencies.length > 0) {
      const distinct = [...new Set(group.frequencies.map((f) => f.trim()))];
      // O mais exigente (mais visitas); empate: o texto mais comum.
      frequency = distinct.sort((a, b) => {
        const diff = parseVisitFrequency(b).visits - parseVisitFrequency(a).visits;
        if (diff !== 0) return diff;
        const count = (t: string) => group.frequencies.filter((f) => f.trim() === t).length;
        return count(b) - count(a);
      })[0];
      if (distinct.length > 1) mixedFrequency.push(`${label(group)}: usada "${frequency}"`);
    }
    if (hasFrequency && !group.note && parseVisitFrequency(frequency).visits === 0) outOfMonth.push(label(group));

    const schedule = group.schedules[0] ?? '';
    if (schedule) fixedDates.push(`${label(group)}: ${formatDateKey(parseFixedDate(schedule)!)}`);

    rows.push({
      'Nome da clínica': group.name,
      Categoria: winningCategory,
      Bairro: group.neighborhood,
      'Endereço': group.address,
      'Quantidade de veterinários': String(veterinarians),
      'Dividir visita em quantas partes': group.split ? '2' : '',
      'Frequência de visita': group.note ? '' : frequency,
      'Data marcada': schedule,
      'Observações': group.note,
    });
    if (group.note) excludedByNote.push(label(group));
  }

  const notices: string[] = [
    `${sheets.length === 1 ? 'A aba foi lida' : `${sheets.length} abas foram lidas`} como categoria${sheets.length === 1 ? '' : 's'} (${sheetLabels.join(', ')}); cada linha era um veterinário, agrupamos por clínica.`,
    `${rows.length} clínicas identificadas a partir de ${totalNamedVets} linhas de veterinário nomeado.`,
  ];
  if (ignoredSheets.length > 0) {
    notices.push(`Abas ignoradas por não serem de categoria: ${ignoredSheets.join(', ')}.`);
  }
  if (hasFrequency) {
    notices.push(
      'Usamos a coluna de frequência de visita: cada clínica entra no mês quantas vezes a frequência pede, e restrições como "sempre sexta" ou "terça ou quinta" são respeitadas no roteiro. Para o próximo mês, basta alterar a frequência na planilha e importar de novo.',
    );
  }
  if (excludedByNote.length > 0) {
    notices.push(
      `${excludedByNote.length} clínica(s) marcadas como "não colocar no roteiro" (visita online) ficaram fora do roteiro, com a anotação guardada nas observações: ${excludedByNote.join('; ')}.`,
    );
  }
  if (fixedDates.length > 0) {
    notices.push(`${fixedDates.length} clínica(s) com data marcada na planilha: ${fixedDates.join('; ')}.`);
  }
  if (outOfMonth.length > 0) {
    notices.push(
      `${outOfMonth.length} clínica(s) sem frequência preenchida ficam fora deste mês (continuam na carteira): ${outOfMonth.slice(0, 15).join('; ')}${outOfMonth.length > 15 ? '…' : ''}.`,
    );
  }
  if (mixedFrequency.length > 0) {
    notices.push(
      `${mixedFrequency.length} clínica(s) têm frequências diferentes entre os veterinários; usamos a mais exigente: ${mixedFrequency.join('; ')}.`,
    );
  }
  if (conflicts.length > 0) {
    notices.push(
      `${conflicts.length} clínica(s) apareceram em mais de uma categoria — mantivemos a categoria com mais veterinários e somamos todos na contagem: ${conflicts.join(' ')}`,
    );
  }
  if (pendingClinics.length > 0) {
    notices.push(
      `${pendingClinics.length} clínica(s) aparecem na planilha sem nenhum veterinário nomeado ainda (provável área nova, ainda sendo mapeada) — entraram na carteira com 1 visita, ajuste na Carteira assim que souber o número real: ${pendingClinics.slice(0, 10).join('; ')}${pendingClinics.length > 10 ? '…' : ''}.`,
    );
  }
  if (unassigned.length > 0) {
    notices.push(
      `${unassigned.length} veterinário(s) sem clínica preenchida foram ignorados (adicione a clínica na planilha e reimporte para incluí-los): ${unassigned.slice(0, 10).join('; ')}${unassigned.length > 10 ? '…' : ''}.`,
    );
  }

  const columns = ['Nome da clínica', 'Categoria', 'Bairro', 'Endereço', 'Quantidade de veterinários', 'Dividir visita em quantas partes'];
  if (hasFrequency) columns.push('Frequência de visita', 'Data marcada');
  if (excludedByNote.length > 0) columns.push('Observações');

  return { columns, rows, notices };
}

/**
 * Anotacao escrita na coluna de endereco que NAO e endereco: "veterinario que
 * faço visita online, NÃO COLOCAR NO ROTEIRO". Mandar isso ao Google como
 * endereco gasta credito e pode devolver um lugar qualquer.
 */
function isRouteExclusionNote(text: string): boolean {
  const key = normalizeKey(text);
  return /nao colocar|fora do roteiro|visita online|atendimento online|\bonline\b/.test(key);
}

function formatDateKey(key: string): string {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
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
  /**
   * Visitas exigidas no mes, da coluna de frequencia. null = a planilha nao
   * tem essa coluna (a clinica segue o ciclo de categorias).
   */
  monthlyVisits: number | null;
  allowedWeekdays: number[];
  preferredWeekdays: number[];
  oneVisitWeekday: number | null;
  /** "YYYY-MM-DD" da data marcada, quando houver. */
  fixedVisitDate: string | null;
  /** Texto original da frequencia. */
  visitRule: string | null;
  issues: RowIssue[];
  geocodeStatus: 'PENDING' | 'RESOLVED' | 'AMBIGUOUS' | 'FAILED' | 'MANUAL';
  geocodeLabel: string | null;
  geocodeCandidates: Array<{ lat: number; lng: number; label: string }>;
}

// "FIXOS" / "VARI 1" / "VARI 2" e como a planilha atual nomeia as abas: os
// fixos sao visitados todo mes (Cat 1); as variaveis sao Cat 2 e Cat 3.
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: 'CAT1' | 'CAT2' | 'CAT3' }> = [
  { pattern: /^(cat\s*)?0*1$|^categoria\s*0*1$|^a$|^fix[oa]s?$/i, category: 'CAT1' },
  { pattern: /^(cat\s*)?0*2$|^categoria\s*0*2$|^b$|^vari[a-z]*\s*0*1$/i, category: 'CAT2' },
  { pattern: /^(cat\s*)?0*3$|^categoria\s*0*3$|^c$|^vari[a-z]*\s*0*2$/i, category: 'CAT3' },
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
  const existingKeys = new Set(existing.map((c) => clinicKey(c.name, c.neighborhood)));

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

    // Fora do mes (frequencia vazia) nao vai ao roteiro: sem localizacao nao
    // e problema agora, e avisar so polui a revisao.
    const outOfMonth = Boolean(mapping.frequency) && parseVisitFrequency(get('frequency')).visits === 0;
    if (latitude === null && !address && !postalCode && !neighborhood && !outOfMonth) {
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

    // Frequencia do mes. "2x no mes em dias alternados" e a mesma regra do
    // antigo "2 VISITAS" (plantao: equipe diferente em cada dia), entao vira
    // visita dividida em partes, cada uma num dia diferente.
    const visitRule = mapping.frequency ? get('frequency') || null : null;
    const frequency = mapping.frequency ? parseVisitFrequency(visitRule) : null;
    if (frequency && frequency.visits > 1 && visitSplits === 1) visitSplits = frequency.visits;
    const fixedVisitDate = mapping.fixedDate ? parseFixedDate(get('fixedDate')) : null;

    if (visitSplits > veterinarians) {
      // Nao da para dividir a visita em mais partes do que ha veterinarios.
      visitSplits = 1;
    }

    const key = clinicKey(name, neighborhood);
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
      monthlyVisits: frequency ? frequency.visits : null,
      allowedWeekdays: frequency?.allowedWeekdays ?? [],
      preferredWeekdays: frequency?.preferredWeekdays ?? [],
      oneVisitWeekday: frequency?.oneVisitWeekday ?? null,
      fixedVisitDate,
      visitRule,
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
    // Fora do mes (frequencia vazia/0): nao vai ao roteiro agora; localizar
    // custaria credito do Google sem uso. Localiza quando voltar a ter visita.
    if (row.monthlyVisits === 0) continue;
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
  /** Clinicas da carteira ausentes da planilha de frequencia: ficam fora do mes. */
  outOfMonth?: number;
  created: number;
  updated: number;
  skipped: number;
  withoutLocation: number;
}

/**
 * Grava as linhas validas na carteira (etapa 11).
 *
 * Reimportar e o uso normal (planilha atualizada todo mes), entao a clinica
 * que ja existe e ATUALIZADA, nunca sobrescrita as cegas:
 *  - o casamento usa a mesma chave normalizada da validacao (sem caixa nem
 *    acento) — senao a revisao promete "sera atualizada" e o commit duplica;
 *  - campo vazio na planilha nao apaga o que ja existe. A planilha real por
 *    veterinario nem tem endereco/telefone; sem isso, reimportar apagaria o
 *    que o usuario completou a mao na Carteira — inclusive a localizacao que
 *    ele escolheu entre os enderecos ambiguos.
 */
export async function commitRows(args: {
  organizationId: string;
  rows: NormalizedRow[];
}): Promise<CommitSummary> {
  const summary: CommitSummary = { created: 0, updated: 0, skipped: 0, withoutLocation: 0 };
  // Planilha com frequencia e a fonte da verdade do mes (ver Clinic.monthlyVisits).
  const frequencySheet = args.rows.some((r) => r.monthlyVisits !== null);
  const presentKeys = new Set(args.rows.filter((r) => r.name).map((r) => clinicKey(r.name, r.neighborhood)));

  const existingClinics = await prisma.clinic.findMany({
    where: { organizationId: args.organizationId },
    select: { id: true, name: true, neighborhood: true, latitude: true, longitude: true },
  });
  const byKey = new Map(
    existingClinics.map((c) => [clinicKey(c.name, c.neighborhood), c] as const),
  );

  for (const row of args.rows) {
    const blocking = row.issues.filter((i) => i.level === 'error');
    if (blocking.length > 0 || !row.name || !row.category) {
      summary.skipped += 1;
      continue;
    }

    const key = clinicKey(row.name, row.neighborhood);
    const existing = byKey.get(key);
    const rowHasCoordinates = row.latitude !== null && row.longitude !== null;
    const keepsExistingLocation =
      !rowHasCoordinates && existing?.latitude != null && existing?.longitude != null;

    if (!rowHasCoordinates && !keepsExistingLocation) summary.withoutLocation += 1;

    const geocodeStatus: GeocodeStatus = rowHasCoordinates
      ? row.geocodeStatus === 'MANUAL'
        ? 'MANUAL'
        : 'RESOLVED'
      : row.geocodeStatus === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : 'FAILED';

    const location = rowHasCoordinates || !existing
      ? {
          latitude: row.latitude,
          longitude: row.longitude,
          geocodeStatus,
          geocodeLabel: row.geocodeLabel,
          geocodedAt: rowHasCoordinates ? new Date() : null,
        }
      : keepsExistingLocation
        ? {}
        : { geocodeStatus, geocodeLabel: row.geocodeLabel };

    // Opcionais: so entram quando a planilha traz valor.
    const optional = Object.fromEntries(
      Object.entries({
        address: row.address,
        city: row.city,
        state: row.state,
        postalCode: row.postalCode,
        phone: row.phone,
        notes: row.notes,
      }).filter(([, value]) => value !== null && value !== ''),
    );

    // Agenda do mes: sempre sobrescreve (a planilha nova e o mes novo),
    // inclusive limpando a data marcada do mes anterior.
    const schedule =
      row.monthlyVisits === null
        ? {}
        : {
            monthlyVisits: row.monthlyVisits,
            allowedWeekdays: row.allowedWeekdays,
            preferredWeekdays: row.preferredWeekdays,
            oneVisitWeekday: row.oneVisitWeekday,
            fixedVisitDate: row.fixedVisitDate ? new Date(`${row.fixedVisitDate}T00:00:00.000Z`) : null,
            visitRule: row.visitRule,
          };

    const data = {
      name: row.name,
      category: row.category,
      neighborhood: row.neighborhood,
      veterinarians: row.veterinarians,
      visitSplits: row.visitSplits,
      active: row.active,
      ...optional,
      ...location,
      ...schedule,
    };

    if (existing) {
      await prisma.clinic.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      const created = await prisma.clinic.create({ data: { ...data, organizationId: args.organizationId } });
      // Linha repetida na mesma planilha atualiza a que acabou de ser criada.
      byKey.set(key, {
        id: created.id,
        name: created.name,
        neighborhood: created.neighborhood,
        latitude: created.latitude,
        longitude: created.longitude,
      });
      summary.created += 1;
    }
  }

  if (frequencySheet) {
    const absentIds = existingClinics
      .filter((c) => !presentKeys.has(clinicKey(c.name, c.neighborhood)))
      .map((c) => c.id);
    if (absentIds.length > 0) {
      await prisma.clinic.updateMany({
        where: { id: { in: absentIds } },
        data: { monthlyVisits: 0, fixedVisitDate: null },
      });
    }
    summary.outOfMonth = absentIds.length;
  }

  logger.info('Importacao concluida', { scope: 'import', ...summary });
  return summary;
}

function clinicKey(name: string, neighborhood: string | null): string {
  return `${normalizeKey(name)}|${normalizeKey(neighborhood ?? '')}`;
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
