'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { MapPinOff, Plus, Search, Upload } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CategoryBadge,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Tabs,
} from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

export interface ClinicRow {
  id: string;
  name: string;
  category: string;
  neighborhood: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  veterinarians: number;
  visitSplits: number;
  geocodeStatus: string;
  lastVisitedAt: string | null;
  nextVisitDate: string | null;
}

type Filter = 'ALL' | 'CAT1' | 'CAT2' | 'CAT3' | 'NO_LOCATION' | 'NO_ADDRESS' | 'INACTIVE';

export function ClinicsWorkspace({
  clinics,
  counts,
}: {
  clinics: ClinicRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const [creating, setCreating] = React.useState(false);
  const [editingVets, setEditingVets] = React.useState<ClinicRow | null>(null);

  const withoutLocation = clinics.filter((c) => c.active && c.latitude === null).length;

  const filtered = React.useMemo(() => {
    const term = search
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

    return clinics.filter((clinic) => {
      if (filter === 'INACTIVE' ? clinic.active : !clinic.active) return false;
      if (filter === 'CAT1' || filter === 'CAT2' || filter === 'CAT3') {
        if (clinic.category !== filter) return false;
      }
      if (filter === 'NO_LOCATION' && clinic.latitude !== null) return false;
      if (filter === 'NO_ADDRESS' && clinic.address) return false;

      if (!term) return true;
      const haystack = `${clinic.name} ${clinic.neighborhood ?? ''} ${clinic.city ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return haystack.includes(term);
    });
  }, [clinics, search, filter]);

  return (
    <div className="space-y-4">
      {withoutLocation > 0 && (
        <Alert tone="warning" title={`${withoutLocation} clínica(s) sem localização`}>
          Elas ficam de fora do roteiro até serem localizadas. Abra cada uma e informe o endereço
          completo ou as coordenadas.
          <button
            onClick={() => setFilter('NO_LOCATION')}
            className="mt-1 block font-medium underline underline-offset-2"
          >
            Ver clínicas sem localização
          </button>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Buscar por nome, bairro ou cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Link href="/carteira/importar">
          <Button variant="outline">
            <Upload className="size-4" />
            Importar planilha
          </Button>
        </Link>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Nova clínica
        </Button>
      </div>

      <Tabs
        active={filter}
        onChange={(id) => setFilter(id as Filter)}
        tabs={[
          { id: 'ALL', label: 'Todas', count: clinics.filter((c) => c.active).length },
          { id: 'CAT1', label: 'Cat 1', count: counts.CAT1 ?? 0 },
          { id: 'CAT2', label: 'Cat 2', count: counts.CAT2 ?? 0 },
          { id: 'CAT3', label: 'Cat 3', count: counts.CAT3 ?? 0 },
          { id: 'NO_LOCATION', label: 'Sem localização', count: withoutLocation },
          { id: 'NO_ADDRESS', label: 'Sem endereço' },
          { id: 'INACTIVE', label: 'Inativas', count: clinics.filter((c) => !c.active).length },
        ]}
      />

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="size-5" strokeWidth={1.75} />}
            title="Nenhuma clínica encontrada"
            description="Ajuste a busca ou o filtro."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left">
              <thead>
                <tr className="border-b border-ink-200 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5">Clínica</th>
                  <th className="px-3 py-2.5">Categoria</th>
                  <th className="px-3 py-2.5">Vets</th>
                  <th className="px-3 py-2.5">Bairro</th>
                  <th className="px-3 py-2.5">Última visita</th>
                  <th className="px-3 py-2.5">Próxima</th>
                  <th className="px-3 py-2.5">Local</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.slice(0, 300).map((clinic) => (
                  <tr key={clinic.id} className={cn('transition-colors hover:bg-ink-50', !clinic.active && 'opacity-55')}>
                    <td className="px-5 py-2.5">
                      <p className="text-sm font-medium text-ink-900">{clinic.name}</p>
                      {clinic.address && <p className="text-[11px] text-ink-400">{clinic.address}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <CategoryBadge category={clinic.category} />
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setEditingVets(clinic)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100"
                        title="Editar veterinários e divisão de visita"
                      >
                        {clinic.veterinarians}
                        {clinic.visitSplits > 1 && (
                          <span className="text-[10px] font-normal text-ink-400">÷{clinic.visitSplits}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-600">
                      {clinic.neighborhood ?? '—'}
                      {clinic.city && <span className="block text-[10px] text-ink-400">{clinic.city}</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-xs text-ink-600">
                      {clinic.lastVisitedAt ? formatDate(clinic.lastVisitedAt) : '—'}
                    </td>
                    <td className="tabular px-3 py-2.5 text-xs">
                      {clinic.nextVisitDate ? (
                        <span className="font-medium text-brand-700">{formatDate(clinic.nextVisitDate)}</span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {clinic.latitude !== null ? (
                        <Badge tone="positive">Localizada</Badge>
                      ) : (
                        <Badge tone="danger">
                          <MapPinOff className="size-2.5" />
                          Sem local
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link
                        href={`/historico?clinic=${clinic.id}`}
                        className="text-xs font-medium text-brand-700 hover:text-brand-900"
                      >
                        Histórico
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="border-t border-ink-200 px-5 py-2.5 text-center text-[11px] text-ink-400">
                Mostrando 300 de {filtered.length}. Refine a busca para ver as demais.
              </p>
            )}
          </div>
        )}
      </Card>

      <NewClinicDialog open={creating} onClose={() => setCreating(false)} onSaved={() => router.refresh()} />
      <EditVeterinariansDialog
        clinic={editingVets}
        onClose={() => setEditingVets(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

/**
 * Edicao de veterinarios e divisao de visita (secao central do produto: a
 * meta conta visitas por veterinario, e algumas clinicas tem a visita
 * dividida em partes separadas por um intervalo minimo de dias).
 */
function EditVeterinariansDialog({
  clinic,
  onClose,
  onSaved,
}: {
  clinic: ClinicRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [veterinarians, setVeterinarians] = React.useState(1);
  const [visitSplits, setVisitSplits] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (clinic) {
      setVeterinarians(clinic.veterinarians);
      setVisitSplits(clinic.visitSplits);
      setError(null);
    }
  }, [clinic]);

  async function save() {
    if (!clinic) return;
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/clinics/${clinic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ veterinarians, visitSplits }),
    });
    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Não foi possível salvar.');
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Dialog
      open={Boolean(clinic)}
      onClose={onClose}
      title="Veterinários e divisão de visita"
      description={clinic?.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={saving}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Quantidade de veterinários"
          hint="A meta mensal conta visitas por veterinário: esta clínica vale essa quantidade de visitas numa única passagem."
        >
          <Input
            type="number"
            min={1}
            max={100}
            value={veterinarians}
            onChange={(e) => {
              const value = Math.max(1, Number(e.target.value) || 1);
              setVeterinarians(value);
              if (visitSplits > value) setVisitSplits(1);
            }}
          />
        </Field>

        <Field
          label="Dividir a visita em quantas partes"
          hint="Cada parte é agendada em um dia diferente, com pelo menos o intervalo mínimo configurado (padrão 7 dias)."
        >
          <Select
            value={String(visitSplits)}
            onChange={(e) => setVisitSplits(Number(e.target.value))}
          >
            <option value="1">Não dividir</option>
            {Array.from({ length: Math.min(veterinarians, 4) - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>{n} partes</option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function NewClinicDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    name: '',
    category: 'CAT1',
    address: '',
    neighborhood: '',
    city: 'Rio de Janeiro',
    state: 'RJ',
    phone: '',
    veterinarians: 1,
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);

    const response = await fetch('/api/clinics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível salvar.');
      return;
    }

    // Geocodificacao pode falhar sem impedir o cadastro — mas o usuario
    // precisa saber, senao a clinica sumiria do roteiro em silencio.
    if (data.clinic?.latitude === null) {
      setNotice('Clínica salva, mas não foi possível localizá-la. Ela ficará de fora do roteiro até receber coordenadas.');
      onSaved();
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nova clínica"
      description="O endereço é usado para localizar a clínica no mapa."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} loading={saving} disabled={form.name.length < 2}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="warning">{notice}</Alert>}

        <Field label="Nome da clínica">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="CAT1">Cat 1 — mensal</option>
              <option value="CAT2">Cat 2 — alternada</option>
              <option value="CAT3">Cat 3 — alternada</option>
            </Select>
          </Field>
          <Field label="Veterinários" hint="Quantas visitas esta clínica vale.">
            <Input
              type="number"
              min={1}
              max={100}
              value={form.veterinarians}
              onChange={(e) => setForm({ ...form, veterinarians: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>

        <Field label="Endereço" hint="Rua e número melhoram muito a precisão da localização.">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Bairro" className="col-span-1">
            <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
          </Field>
          <Field label="Cidade" className="col-span-1">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="UF" className="col-span-1">
            <Input value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
