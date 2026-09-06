'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, MapPin, Upload } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * ASSISTENTE DE IMPORTACAO (secao 8).
 *
 * Quatro passos com revisao humana obrigatoria antes de gravar. O passo de
 * revisao e o que impede uma planilha suja de virar uma carteira errada — e
 * uma carteira errada estraga o roteiro todos os meses seguintes.
 */

const CANONICAL = [
  { field: 'name', label: 'Nome da clínica', required: true },
  { field: 'category', label: 'Categoria', required: true },
  { field: 'address', label: 'Endereço', required: false },
  { field: 'neighborhood', label: 'Bairro', required: false },
  { field: 'city', label: 'Cidade', required: false },
  { field: 'state', label: 'Estado (UF)', required: false },
  { field: 'postalCode', label: 'CEP', required: false },
  { field: 'phone', label: 'Telefone', required: false },
  { field: 'latitude', label: 'Latitude', required: false },
  { field: 'longitude', label: 'Longitude', required: false },
  { field: 'veterinarians', label: 'Quantidade de veterinários', required: false },
  { field: 'visitSplits', label: 'Dividir visita em quantas partes', required: false },
  { field: 'notes', label: 'Observações', required: false },
  { field: 'active', label: 'Ativo', required: false },
] as const;

type Step = 'upload' | 'mapping' | 'review' | 'done';

interface UploadResult {
  batchId: string;
  filename: string;
  columns: string[];
  mapping: Record<string, string>;
  totalRows: number;
  preview: Array<Record<string, string>>;
  /** Avisos do processo de leitura — ex.: "3 abas viraram 3 categorias". */
  notices: string[];
}

interface RowIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

interface ReviewRow {
  index: number;
  name: string;
  category: string | null;
  neighborhood: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  veterinarians: number;
  visitSplits: number;
  geocodeStatus: string;
  geocodeLabel: string | null;
  geocodeCandidates: Array<{ lat: number; lng: number; label: string }>;
  issues: RowIssue[];
}

interface ReviewResult {
  batchId: string;
  rows: ReviewRow[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    located: number;
    ambiguous: number;
    needsAttention: number;
  };
}

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>('upload');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [upload, setUpload] = React.useState<UploadResult | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [review, setReview] = React.useState<ReviewResult | null>(null);
  const [overrides, setOverrides] = React.useState<Record<number, { category?: string; skip?: boolean; latitude?: number; longitude?: number }>>({});
  const [summary, setSummary] = React.useState<{ created: number; updated: number; skipped: number; withoutLocation: number } | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append('file', file);

    const response = await fetch('/api/import', { method: 'POST', body });
    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível ler a planilha.');
      return;
    }

    setUpload(data);
    setMapping(data.mapping);
    setStep('mapping');
  }

  async function validate() {
    if (!upload) return;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/import', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: upload.batchId, mapping, geocode: true }),
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(data.error ?? 'Falha na validação.');
      return;
    }

    setReview(data);
    setStep('review');
  }

  async function commit() {
    if (!review) return;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/import', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: review.batchId,
        overrides: Object.entries(overrides).map(([index, value]) => ({ index: Number(index), ...value })),
      }),
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(data.error ?? 'Falha ao importar.');
      return;
    }

    setSummary(data);
    setStep('done');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Steps current={step} />

      {error && <Alert tone="danger">{error}</Alert>}

      {step === 'upload' && <UploadStep onFile={handleFile} busy={busy} />}

      {step === 'mapping' && upload && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-ink-900">Confira as colunas</p>
              <p className="mt-0.5 text-xs text-ink-500">
                Detectamos {upload.columns.length} colunas em <strong>{upload.filename}</strong> e{' '}
                {upload.totalRows} linhas. Ajuste o que não corresponder.
              </p>
            </div>

            {upload.notices.length > 0 && (
              <Alert tone="info" title="Como interpretamos sua planilha">
                <ul className="list-disc space-y-1 pl-4">
                  {upload.notices.map((notice, i) => (
                    <li key={i}>{notice}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {CANONICAL.map((item) => (
                <Field
                  key={item.field}
                  label={`${item.label}${item.required ? ' *' : ''}`}
                >
                  <Select
                    value={mapping[item.field] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [item.field]: e.target.value })}
                  >
                    <option value="">— não usar —</option>
                    {upload.columns.map((column) => (
                      <option key={column} value={column}>{column}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-ink-50">
                  <tr>
                    {upload.columns.slice(0, 7).map((column) => (
                      <th key={column} className="px-2.5 py-1.5 font-semibold text-ink-500">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {upload.preview.slice(0, 4).map((row, i) => (
                    <tr key={i}>
                      {upload.columns.slice(0, 7).map((column) => (
                        <td key={column} className="max-w-40 truncate px-2.5 py-1.5 text-ink-600">
                          {row[column]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('upload')}>Voltar</Button>
              <Button
                onClick={validate}
                loading={busy}
                disabled={!mapping.name || !mapping.category}
              >
                Validar e localizar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'review' && review && (
        <ReviewStep
          review={review}
          overrides={overrides}
          setOverrides={setOverrides}
          onBack={() => setStep('mapping')}
          onCommit={commit}
          busy={busy}
        />
      )}

      {step === 'done' && summary && (
        <Card className="animate-[rise_0.3s_ease-out]">
          <CardContent className="space-y-4 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[var(--color-positive-soft)]">
              <Check className="size-5 text-[var(--color-positive)]" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">Importação concluída</p>
              <p className="mt-1 text-xs text-ink-500">
                {summary.created} criadas · {summary.updated} atualizadas
                {summary.skipped > 0 && <> · {summary.skipped} ignoradas</>}
              </p>
            </div>

            {summary.withoutLocation > 0 && (
              <Alert tone="warning">
                {summary.withoutLocation} clínica(s) ficaram sem localização e não entrarão no roteiro
                até serem corrigidas.
              </Alert>
            )}

            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => { setStep('upload'); setUpload(null); setReview(null); setSummary(null); }}>
                Importar outra planilha
              </Button>
              <Button onClick={() => router.push('/carteira')}>Ver carteira</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Steps({ current }: { current: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'upload', label: 'Enviar' },
    { id: 'mapping', label: 'Mapear colunas' },
    { id: 'review', label: 'Revisar' },
    { id: 'done', label: 'Concluir' },
  ];
  const currentIndex = steps.findIndex((s) => s.id === current);

  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, index) => (
        <li key={step.id} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'tabular flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
              index < currentIndex
                ? 'bg-[var(--color-positive)] text-[var(--color-on-brand)]'
                : index === currentIndex
                  ? 'bg-brand-600 text-[var(--color-on-brand)]'
                  : 'bg-ink-200 text-ink-500',
            )}
          >
            {index < currentIndex ? <Check className="size-3" strokeWidth={3} /> : index + 1}
          </span>
          <span
            className={cn(
              'hidden text-xs font-medium sm:block',
              index <= currentIndex ? 'text-ink-800' : 'text-ink-400',
            )}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span className={cn('h-px flex-1', index < currentIndex ? 'bg-[var(--color-positive)]' : 'bg-ink-200')} />
          )}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardContent>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-300 hover:border-ink-400 hover:bg-ink-50',
          )}
        >
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
            {busy ? <Spinner className="size-5" /> : <FileSpreadsheet className="size-5" strokeWidth={1.75} />}
          </div>
          <p className="text-sm font-medium text-ink-800">
            {busy ? 'Lendo a planilha...' : 'Arraste sua planilha aqui'}
          </p>
          <p className="mt-1 text-xs text-ink-500">XLSX ou CSV · até 8 MB</p>
          <Button variant="outline" size="sm" className="mt-4" disabled={busy}>
            <Upload className="size-3.5" />
            Escolher arquivo
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>

        <div className="mt-4 rounded-lg bg-ink-50 px-4 py-3 text-[11px] leading-relaxed text-ink-500">
          <p className="font-medium text-ink-700">O que a planilha precisa ter</p>
          <p className="mt-1">
            No mínimo <strong>nome</strong> e <strong>categoria</strong> (Cat 1 / Cat 2 / Cat 3).
            Endereço, bairro, cidade e CEP melhoram muito a localização, porque nome e bairro sozinhos
            frequentemente não bastam para encontrar o endereço exato. Também aceitamos uma linha por
            veterinário, com a categoria sendo o nome da aba (CAT 1, CAT 2, CAT 3).
          </p>
          <a
            href="/exemplo-carteira-facilitavet.xlsx"
            download
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            <Download className="size-3.5" />
            Baixar planilha de exemplo
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewStep({
  review,
  overrides,
  setOverrides,
  onBack,
  onCommit,
  busy,
}: {
  review: ReviewResult;
  overrides: Record<number, { category?: string; skip?: boolean; latitude?: number; longitude?: number }>;
  setOverrides: React.Dispatch<React.SetStateAction<Record<number, { category?: string; skip?: boolean; latitude?: number; longitude?: number }>>>;
  onBack: () => void;
  onCommit: () => void;
  busy: boolean;
}) {
  const [onlyProblems, setOnlyProblems] = React.useState(true);
  const s = review.summary;

  const rows = onlyProblems
    ? review.rows.filter((r) => r.issues.length > 0 || r.latitude === null)
    : review.rows;

  return (
    <div className="space-y-4">
      {/* Resumo — o "100 importadas / 96 localizadas / 4 precisam de correcao" */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Linhas lidas" value={s.total} />
        <SummaryTile label="Localizadas" value={s.located} tone="positive" />
        <SummaryTile label="Precisam de atenção" value={s.needsAttention} tone={s.needsAttention > 0 ? 'warning' : undefined} />
        <SummaryTile label="Com erro" value={s.errors} tone={s.errors > 0 ? 'danger' : undefined} />
      </div>

      {s.duplicates > 0 && (
        <Alert tone="info">
          {s.duplicates} linha(s) já existem na carteira ou estão repetidas na planilha. As existentes
          serão <strong>atualizadas</strong>, não duplicadas.
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <p className="text-sm font-semibold text-ink-900">Revisão</p>
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
              className="size-3.5 rounded border-ink-300 accent-brand-600"
            />
            Mostrar só o que precisa de atenção
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Check className="mx-auto size-6 text-[var(--color-positive)]" strokeWidth={2} />
            <p className="mt-2 text-sm font-medium text-ink-800">Tudo certo</p>
            <p className="text-xs text-ink-500">Todas as linhas foram validadas e localizadas.</p>
          </div>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-ink-100 overflow-y-auto">
            {rows.slice(0, 200).map((row) => {
              const override = overrides[row.index] ?? {};
              const skipped = override.skip;

              return (
                <li key={row.index} className={cn('px-5 py-3', skipped && 'opacity-50')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {row.name || <span className="text-[var(--color-danger)]">— sem nome —</span>}
                      </p>
                      <p className="truncate text-[11px] text-ink-400">
                        linha {row.index + 2} · {row.neighborhood ?? 'sem bairro'}
                        {row.city && ` · ${row.city}`}
                      </p>

                      <div className="mt-1.5 space-y-1">
                        {row.issues.map((issue, i) => (
                          <p
                            key={i}
                            className={cn(
                              'flex items-start gap-1.5 text-[11px]',
                              issue.level === 'error'
                                ? 'text-[var(--color-danger-text)]'
                                : 'text-ink-500',
                            )}
                          >
                            <AlertTriangle className="mt-px size-3 shrink-0" />
                            {issue.message}
                          </p>
                        ))}
                        {row.latitude === null && row.geocodeStatus === 'FAILED' && (
                          <>
                            <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-warning-text)]">
                              <MapPin className="mt-px size-3 shrink-0" />
                              {row.geocodeLabel ?? 'Não foi possível localizar.'}
                            </p>
                            <ManualCoordinates
                              value={override}
                              onChange={(next) =>
                                setOverrides((prev) => ({ ...prev, [row.index]: { ...prev[row.index], ...next } }))
                              }
                            />
                          </>
                        )}
                      </div>

                      {/* Ambiguidade: o usuario escolhe, o sistema nunca chuta */}
                      {row.geocodeStatus === 'AMBIGUOUS' && row.geocodeCandidates.length > 0 && (
                        <div className="mt-2 space-y-1 rounded-lg bg-ink-50 p-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                            Vários endereços possíveis, escolha um
                          </p>
                          {row.geocodeCandidates.slice(0, 4).map((candidate, i) => {
                            const chosen = override.latitude === candidate.lat;
                            return (
                              <button
                                key={i}
                                onClick={() =>
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [row.index]: { ...prev[row.index], latitude: candidate.lat, longitude: candidate.lng },
                                  }))
                                }
                                className={cn(
                                  'block w-full truncate rounded px-2 py-1 text-left text-[11px] transition-colors',
                                  chosen ? 'bg-brand-100 font-medium text-brand-900' : 'text-ink-600 hover:bg-surface',
                                )}
                              >
                                {chosen && '✓ '}{candidate.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {row.category ? (
                        <div className="flex items-center gap-1.5">
                          {row.veterinarians > 1 && (
                            <span className="text-[10px] font-medium text-ink-400">
                              {row.veterinarians} vet{row.veterinarians > 1 ? 's' : ''}
                              {row.visitSplits > 1 ? ` · ${row.visitSplits}x` : ''}
                            </span>
                          )}
                          <Badge tone={row.category === 'CAT1' ? 'cat1' : row.category === 'CAT2' ? 'cat2' : 'cat3'}>
                            {row.category.replace('CAT', 'Cat ')}
                          </Badge>
                        </div>
                      ) : (
                        <Select
                          value={override.category ?? ''}
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [row.index]: { ...prev[row.index], category: e.target.value },
                            }))
                          }
                          className="h-7 w-28 text-[11px]"
                        >
                          <option value="">Categoria...</option>
                          <option value="CAT1">Cat 1</option>
                          <option value="CAT2">Cat 2</option>
                          <option value="CAT3">Cat 3</option>
                        </Select>
                      )}

                      <button
                        onClick={() =>
                          setOverrides((prev) => ({
                            ...prev,
                            [row.index]: { ...prev[row.index], skip: !skipped },
                          }))
                        }
                        className="text-[11px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-800"
                      >
                        {skipped ? 'Incluir' : 'Ignorar linha'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button onClick={onCommit} loading={busy}>
          Importar {s.valid} clínica{s.valid === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Localizacao manual quando o Google nao conseguiu geocodificar (ex: chave
 * sem faturamento ativo). Nao depende de nenhuma API: o usuario abre o local
 * no maps.google.com normal, clica com o botao direito no pino e copia as
 * coordenadas que aparecem no menu — funciona mesmo com a integracao do
 * Google fora do ar.
 */
function ManualCoordinates({
  value,
  onChange,
}: {
  value: { latitude?: number; longitude?: number };
  onChange: (next: { latitude?: number; longitude?: number }) => void;
}) {
  const [lat, setLat] = React.useState(value.latitude !== undefined ? String(value.latitude) : '');
  const [lng, setLng] = React.useState(value.longitude !== undefined ? String(value.longitude) : '');

  function update(nextLat: string, nextLng: string) {
    setLat(nextLat);
    setLng(nextLng);
    const parsedLat = Number(nextLat.replace(',', '.'));
    const parsedLng = Number(nextLng.replace(',', '.'));
    const valid = nextLat.trim() !== '' && nextLng.trim() !== '' && Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
    onChange(valid ? { latitude: parsedLat, longitude: parsedLng } : { latitude: undefined, longitude: undefined });
  }

  const filled = value.latitude !== undefined && value.longitude !== undefined;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          placeholder="Latitude"
          value={lat}
          onChange={(e) => update(e.target.value, lng)}
          className="h-7 w-24 text-[11px]"
          inputMode="decimal"
        />
        <Input
          placeholder="Longitude"
          value={lng}
          onChange={(e) => update(lat, e.target.value)}
          className="h-7 w-24 text-[11px]"
          inputMode="decimal"
        />
        {filled && <Check className="size-3.5 shrink-0 text-[var(--color-positive)]" />}
      </div>
      <p className="mt-0.5 text-[10px] text-ink-400">
        Copie do Google Maps: clique com o botão direito no local e depois nas coordenadas.
      </p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'positive' | 'warning' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="!px-4 !py-3">
        <p className="text-[11px] font-medium text-ink-500">{label}</p>
        <p
          className={cn(
            'tabular mt-0.5 text-2xl font-semibold tracking-tight',
            tone === 'positive' && 'text-[var(--color-positive)]',
            tone === 'warning' && 'text-[var(--color-warning-text)]',
            tone === 'danger' && 'text-[var(--color-danger)]',
            !tone && 'text-ink-900',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
