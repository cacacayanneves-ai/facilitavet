import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { fail, handle } from '@/lib/api';
import {
  commitRows,
  geocodeRows,
  parseSpreadsheet,
  suggestColumnMapping,
  validateRows,
  type NormalizedRow,
} from '@/lib/services/import';

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Etapa 1: upload + leitura + sugestao de mapeamento.
 *
 * Nao gravamos nada na carteira aqui. O lote fica em ImportBatch ate o usuario
 * revisar e confirmar — uma planilha comercial suja importada direto produz
 * uma carteira errada que contamina o roteiro o ano inteiro.
 */
export async function POST(request: Request) {
  const user = await requireApiUser().catch(() => null);
  if (!user) return fail('Sessao expirada. Entre novamente.', 401);

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) return fail('Envie um arquivo XLSX ou CSV.', 422);
  if (file.size > MAX_BYTES) return fail('Arquivo acima de 8 MB.', 413);
  if (!/\.(xlsx|csv)$/i.test(file.name)) return fail('Formato não suportado. Use XLSX ou CSV.', 415);

  return handle('api.import.upload', async () => {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sheet = await parseSpreadsheet(file.name, buffer);

    if (sheet.rows.length === 0) {
      throw new Error('A planilha não tem linhas de dados.');
    }

    const mapping = suggestColumnMapping(sheet.columns);

    const batch = await prisma.importBatch.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        filename: file.name,
        status: 'MAPPED',
        detectedColumns: sheet.columns,
        columnMapping: mapping,
        rows: sheet.rows as unknown as object,
        totalRows: sheet.rows.length,
      },
    });

    return {
      batchId: batch.id,
      filename: file.name,
      columns: sheet.columns,
      mapping,
      notices: sheet.notices,
      totalRows: sheet.rows.length,
      preview: sheet.rows.slice(0, 8),
    };
  });
}

const validateSchema = z.object({
  batchId: z.string().min(1),
  mapping: z.record(z.string(), z.string()),
  geocode: z.boolean().optional(),
});

/**
 * Etapa 2: valida com o mapeamento confirmado, detecta duplicidades e
 * geocodifica. Devolve o diagnostico linha a linha para revisao.
 */
export async function PUT(request: Request) {
  return handle('api.import.validate', async () => {
    const user = await requireApiUser();
    const input = validateSchema.parse(await request.json());

    const batch = await prisma.importBatch.findFirst({
      where: { id: input.batchId, organizationId: user.organizationId },
    });
    if (!batch) throw new Error('Lote de importação não encontrado.');

    const rows = batch.rows as unknown as Array<Record<string, string>>;
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });

    let normalized = await validateRows({
      rows,
      mapping: input.mapping as Parameters<typeof validateRows>[0]['mapping'],
      organizationId: user.organizationId,
      defaults: { city: settings?.city, state: settings?.state },
    });

    if (input.geocode !== false) {
      normalized = await geocodeRows(normalized, {
        defaults: { city: settings?.city, state: settings?.state },
      });
    }

    const summary = summarize(normalized);

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'REVIEW',
        columnMapping: input.mapping,
        rows: normalized as unknown as object,
        validRows: summary.valid,
        geocodedRows: summary.located,
        duplicateRows: summary.duplicates,
        errorRows: summary.errors,
      },
    });

    return { batchId: batch.id, rows: normalized, summary };
  });
}

const commitSchema = z.object({
  batchId: z.string().min(1),
  /** Correcoes manuais feitas na revisao. */
  overrides: z
    .array(
      z.object({
        index: z.number().int().min(0),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        category: z.enum(['CAT1', 'CAT2', 'CAT3']).nullable().optional(),
        skip: z.boolean().optional(),
      }),
    )
    .optional(),
});

/** Etapa 3: grava na carteira. */
export async function PATCH(request: Request) {
  return handle('api.import.commit', async () => {
    const user = await requireApiUser();
    const input = commitSchema.parse(await request.json());

    const batch = await prisma.importBatch.findFirst({
      where: { id: input.batchId, organizationId: user.organizationId },
    });
    if (!batch) throw new Error('Lote de importação não encontrado.');
    if (batch.status === 'COMMITTED') throw new Error('Este lote já foi importado.');

    const rows = batch.rows as unknown as NormalizedRow[];
    const overrides = new Map((input.overrides ?? []).map((o) => [o.index, o]));

    const prepared = rows
      .filter((row) => !overrides.get(row.index)?.skip)
      .map((row) => {
        const override = overrides.get(row.index);
        if (!override) return row;
        const next: NormalizedRow = { ...row };
        if (override.latitude !== undefined && override.latitude !== null) next.latitude = override.latitude;
        if (override.longitude !== undefined && override.longitude !== null) next.longitude = override.longitude;
        if (override.category) {
          next.category = override.category;
          // Corrigir a categoria na revisao resolve o erro que a bloqueava.
          next.issues = next.issues.filter((issue) => issue.code !== 'INVALID_CATEGORY');
        }
        if (next.latitude !== null && next.longitude !== null) next.geocodeStatus = 'MANUAL';
        return next;
      });

    const summary = await commitRows({ organizationId: user.organizationId, rows: prepared });

    await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'COMMITTED' } });

    return summary;
  });
}

function summarize(rows: NormalizedRow[]) {
  let errors = 0;
  let duplicates = 0;
  let located = 0;
  let ambiguous = 0;

  for (const row of rows) {
    if (row.issues.some((i) => i.level === 'error')) errors += 1;
    if (row.issues.some((i) => i.code === 'DUPLICATE_IN_FILE' || i.code === 'DUPLICATE_IN_DATABASE')) {
      duplicates += 1;
    }
    if (row.latitude !== null && row.longitude !== null) located += 1;
    if (row.geocodeStatus === 'AMBIGUOUS') ambiguous += 1;
  }

  return {
    total: rows.length,
    valid: rows.length - errors,
    errors,
    duplicates,
    located,
    ambiguous,
    needsAttention: rows.length - located,
  };
}
