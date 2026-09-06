'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Check, MessageCircle, Sparkles, MapPin } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  Switch,
  Tabs,
} from '@/components/ui';
import type { CategoryRuleSet, ScoreWeights } from '@/lib/route-planner';
import { cn, monthName } from '@/lib/utils';

const WEEKDAYS = [
  { value: 0, short: 'D', label: 'Domingo' },
  { value: 1, short: 'S', label: 'Segunda' },
  { value: 2, short: 'T', label: 'Terça' },
  { value: 3, short: 'Q', label: 'Quarta' },
  { value: 4, short: 'Q', label: 'Quinta' },
  { value: 5, short: 'S', label: 'Sexta' },
  { value: 6, short: 'S', label: 'Sábado' },
];

interface Settings {
  workDays: number[];
  workStartTime: string;
  workEndTime: string;
  lunchStart: string | null;
  lunchEnd: string | null;
  visitDurationMinutes: number;
  bufferMinutes: number;
  originType: string;
  originAddress: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationType: string;
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  monthlyTarget: number;
  minVisitsPerDay: number;
  maxVisitsPerDay: number;
  country: string;
  state: string | null;
  city: string | null;
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  whatsappTime: string;
  whatsappDays: number[];
  whatsappIncludeRoute: boolean;
  whatsappIncludeDistance: boolean;
  whatsappIncludeTimes: boolean;
  whatsappIncludeMapLink: boolean;
}

export function SettingsWorkspace(props: {
  profile: { name: string; email: string; phone: string | null; company: string | null };
  settings: Settings;
  categoryRules: CategoryRuleSet;
  scoreWeights: ScoreWeights;
  clinicCounts: Record<string, number>;
  providerStatus: { maps: boolean; claude: boolean; whatsapp: boolean };
  recentMessages: Array<{
    id: string;
    status: string;
    scheduledFor: string;
    sentAt: string | null;
    error: string | null;
    body: string;
  }>;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState('perfil');
  const [profile, setProfile] = React.useState(props.profile);
  const [settings, setSettings] = React.useState(props.settings);
  const [rules, setRules] = React.useState(props.categoryRules);
  const [weights, setWeights] = React.useState(props.scoreWeights);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);

    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: { name: profile.name, phone: profile.phone, company: profile.company },
        work: {
          workDays: settings.workDays,
          workStartTime: settings.workStartTime,
          workEndTime: settings.workEndTime,
          lunchStart: settings.lunchStart,
          lunchEnd: settings.lunchEnd,
          visitDurationMinutes: settings.visitDurationMinutes,
          bufferMinutes: settings.bufferMinutes,
        },
        anchors: {
          originType: settings.originType,
          originAddress: settings.originAddress,
          originLatitude: settings.originLatitude,
          originLongitude: settings.originLongitude,
          destinationType: settings.destinationType,
          destinationAddress: settings.destinationAddress,
          destinationLatitude: settings.destinationLatitude,
          destinationLongitude: settings.destinationLongitude,
          geocode: true,
        },
        targets: {
          monthlyTarget: settings.monthlyTarget,
          minVisitsPerDay: settings.minVisitsPerDay,
          maxVisitsPerDay: settings.maxVisitsPerDay,
        },
        categoryRules: rules,
        scoreWeights: weights,
        region: { country: settings.country, state: settings.state, city: settings.city },
        notifications: {
          whatsappEnabled: settings.whatsappEnabled,
          whatsappNumber: settings.whatsappNumber,
          whatsappTime: settings.whatsappTime,
          whatsappDays: settings.whatsappDays,
          whatsappIncludeRoute: settings.whatsappIncludeRoute,
          whatsappIncludeDistance: settings.whatsappIncludeDistance,
          whatsappIncludeTimes: settings.whatsappIncludeTimes,
          whatsappIncludeMapLink: settings.whatsappIncludeMapLink,
        },
      }),
    });

    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(data.error ?? 'Não foi possível salvar.');
      return;
    }

    if (data.geocodeWarning) setNotice(data.geocodeWarning);
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
    router.refresh();
  }

  function toggleWorkDay(day: number) {
    setSettings((s) => ({
      ...s,
      workDays: s.workDays.includes(day) ? s.workDays.filter((d) => d !== day) : [...s.workDays, day].sort(),
    }));
  }

  function toggleWhatsappDay(day: number) {
    setSettings((s) => ({
      ...s,
      whatsappDays: s.whatsappDays.includes(day)
        ? s.whatsappDays.filter((d) => d !== day)
        : [...s.whatsappDays, day].sort(),
    }));
  }

  // Previsao do ciclo a partir das regras EDITADAS, para o usuario ver o efeito
  // da mudanca antes de salvar.
  const forecast = React.useMemo(() => {
    const order = rules.alternatingOrder.filter((c) => rules.rules[c]?.enabled);
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const abs = now.getUTCFullYear() * 12 + now.getUTCMonth() + i;
      const year = Math.floor(abs / 12);
      const month = (abs % 12) + 1;
      const monthly = (Object.keys(rules.rules) as Array<keyof typeof rules.rules>).filter(
        (c) => rules.rules[c].enabled && rules.rules[c].frequency === 'monthly',
      );
      const delta = abs - (rules.anchorYear * 12 + (rules.anchorMonth - 1));
      const alternating = order.length ? [order[((delta % order.length) + order.length) % order.length]] : [];
      return { year, month, categories: [...monthly, ...alternating] };
    });
  }, [rules]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'perfil', label: 'Perfil' },
            { id: 'jornada', label: 'Jornada' },
            { id: 'regras', label: 'Regras comerciais' },
            { id: 'rota', label: 'Rota' },
            { id: 'whatsapp', label: 'WhatsApp' },
            { id: 'integracoes', label: 'Integrações' },
          ]}
        />
        <Button onClick={save} loading={saving}>
          {saved && <Check className="size-3.5" strokeWidth={3} />}
          {saved ? 'Salvo' : 'Salvar alterações'}
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="warning">{notice}</Alert>}

      {tab === 'perfil' && (
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="E-mail" hint="O e-mail é o seu login e não pode ser alterado aqui.">
              <Input value={profile.email} disabled />
            </Field>
            <Field label="Empresa">
              <Input value={profile.company ?? ''} onChange={(e) => setProfile({ ...profile, company: e.target.value })} />
            </Field>
            <Field label="Telefone">
              <Input value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </Field>
          </CardContent>
        </Card>
      )}

      {tab === 'jornada' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Dias de trabalho</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Feriados nacionais são excluídos automaticamente. Você pode bloquear dias
                  específicos na tela de Planejamento.
                </p>
              </div>
              <div className="flex gap-2">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    onClick={() => toggleWorkDay(day.value)}
                    title={day.label}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-lg text-sm font-semibold transition-all',
                      settings.workDays.includes(day.value)
                        ? 'bg-brand-600 text-white shadow-[var(--shadow-subtle)]'
                        : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                    )}
                  >
                    {day.short}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 border-t border-ink-200 pt-4 sm:grid-cols-4">
                <Field label="Início">
                  <Input type="time" value={settings.workStartTime} onChange={(e) => setSettings({ ...settings, workStartTime: e.target.value })} />
                </Field>
                <Field label="Fim">
                  <Input type="time" value={settings.workEndTime} onChange={(e) => setSettings({ ...settings, workEndTime: e.target.value })} />
                </Field>
                <Field label="Almoço — início">
                  <Input type="time" value={settings.lunchStart ?? ''} onChange={(e) => setSettings({ ...settings, lunchStart: e.target.value || null })} />
                </Field>
                <Field label="Almoço — fim">
                  <Input type="time" value={settings.lunchEnd ?? ''} onChange={(e) => setSettings({ ...settings, lunchEnd: e.target.value || null })} />
                </Field>
              </div>

              <div className="grid gap-4 border-t border-ink-200 pt-4 sm:grid-cols-2">
                <Field label="Duração média da visita (min)" hint="Usada para calcular os horários de chegada.">
                  <Input
                    type="number"
                    min={5}
                    max={240}
                    value={settings.visitDurationMinutes}
                    onChange={(e) => setSettings({ ...settings, visitDurationMinutes: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Folga entre visitas (min)">
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={settings.bufferMinutes}
                    onChange={(e) => setSettings({ ...settings, bufferMinutes: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="País">
                <Input value={settings.country} maxLength={2} onChange={(e) => setSettings({ ...settings, country: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Estado (UF)" hint="Define os feriados estaduais.">
                <Input value={settings.state ?? ''} maxLength={2} onChange={(e) => setSettings({ ...settings, state: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Cidade" hint="Define os feriados municipais.">
                <Input value={settings.city ?? ''} onChange={(e) => setSettings({ ...settings, city: e.target.value })} />
              </Field>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'regras' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Ciclo de categorias</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Estas regras não estão no código — são configuração. Mude a frequência, a
                  quantidade ou a ordem do rodízio e o motor passa a obedecer no próximo
                  planejamento.
                </p>
              </div>

              <div className="space-y-3">
                {(['CAT1', 'CAT2', 'CAT3'] as const).map((category) => {
                  const rule = rules.rules[category];
                  return (
                    <div key={category} className="rounded-xl border border-ink-200 p-3.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: `var(--color-${category.toLowerCase()})` }}
                        />
                        <span className="text-sm font-semibold text-ink-900">
                          {category.replace('CAT', 'Cat ')}
                        </span>
                        <Badge tone="neutral">{props.clinicCounts[category] ?? 0} na carteira</Badge>

                        <div className="ml-auto flex flex-wrap items-center gap-3">
                          <Select
                            value={rule.frequency}
                            onChange={(e) =>
                              setRules((r) => ({
                                ...r,
                                rules: { ...r.rules, [category]: { ...rule, frequency: e.target.value as 'monthly' } },
                              }))
                            }
                            className="h-8 w-40 text-xs"
                          >
                            <option value="monthly">Todo mês</option>
                            <option value="alternating">Mês sim, mês não</option>
                            <option value="manual">Manual</option>
                          </Select>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-ink-500">meta</span>
                            <Input
                              type="number"
                              min={0}
                              max={1000}
                              value={rule.targetCount}
                              onChange={(e) =>
                                setRules((r) => ({
                                  ...r,
                                  rules: { ...r.rules, [category]: { ...rule, targetCount: Number(e.target.value) } },
                                }))
                              }
                              className="tabular h-8 w-20 text-xs"
                            />
                          </div>

                          <Switch
                            checked={rule.enabled}
                            onChange={(value) =>
                              setRules((r) => ({
                                ...r,
                                rules: { ...r.rules, [category]: { ...rule, enabled: value } },
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-4 border-t border-ink-200 pt-4 sm:grid-cols-3">
                <Field label="Ordem do rodízio" hint="Qual categoria alternada vem primeiro.">
                  <Select
                    value={rules.alternatingOrder.join(',')}
                    onChange={(e) =>
                      setRules((r) => ({ ...r, alternatingOrder: e.target.value.split(',') as CategoryRuleSet['alternatingOrder'] }))
                    }
                  >
                    <option value="CAT2,CAT3">Cat 2 → Cat 3</option>
                    <option value="CAT3,CAT2">Cat 3 → Cat 2</option>
                  </Select>
                </Field>
                <Field label="Mês âncora" hint="Onde o rodízio começa.">
                  <Select
                    value={String(rules.anchorMonth)}
                    onChange={(e) => setRules((r) => ({ ...r, anchorMonth: Number(e.target.value) }))}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1} className="capitalize">
                        {monthName(i + 1)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ano âncora">
                  <Input
                    type="number"
                    min={2000}
                    max={2100}
                    value={rules.anchorYear}
                    onChange={(e) => setRules((r) => ({ ...r, anchorYear: Number(e.target.value) }))}
                    className="tabular"
                  />
                </Field>
              </div>

              <div className="rounded-lg bg-ink-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  Efeito das regras nos próximos meses
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {forecast.map((item) => (
                    <span
                      key={`${item.year}-${item.month}`}
                      className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-ink-600 shadow-[var(--shadow-subtle)]"
                    >
                      <span className="capitalize">{monthName(item.month).slice(0, 3)}</span>{' '}
                      <span className="text-ink-900">
                        {item.categories.map((c) => c.replace('CAT', 'Cat ')).join(' + ')}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <Switch
                checked={rules.enforceExclusivity}
                onChange={(value) => setRules((r) => ({ ...r, enforceExclusivity: value }))}
                label="Validar exclusividade entre categorias"
                description="Alerta quando a mesma clínica aparece na carteira em mais de uma categoria."
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Meta mensal de visitas">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.monthlyTarget}
                  onChange={(e) => setSettings({ ...settings, monthlyTarget: Number(e.target.value) })}
                  className="tabular"
                />
              </Field>
              <Field label="Mínimo por dia">
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.minVisitsPerDay}
                  onChange={(e) => setSettings({ ...settings, minVisitsPerDay: Number(e.target.value) })}
                  className="tabular"
                />
              </Field>
              <Field label="Máximo por dia" hint="Limita a capacidade diária do planejamento.">
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.maxVisitsPerDay}
                  onChange={(e) => setSettings({ ...settings, maxVisitsPerDay: Number(e.target.value) })}
                  className="tabular"
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'rota' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Origem e destino</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  De onde você sai e para onde volta. &quot;Última visita&quot; encadeia os dias:
                  cada dia começa perto de onde o anterior terminou.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Origem">
                    <Select value={settings.originType} onChange={(e) => setSettings({ ...settings, originType: e.target.value })}>
                      <option value="HOME">Casa</option>
                      <option value="OFFICE">Escritório</option>
                      <option value="LAST_VISIT">Última visita do dia anterior</option>
                      <option value="MANUAL">Endereço manual</option>
                      <option value="NONE">Sem origem definida</option>
                    </Select>
                  </Field>
                  {settings.originType !== 'NONE' && settings.originType !== 'LAST_VISIT' && (
                    <Field label="Endereço de origem" hint={coordinateHint(settings.originLatitude, settings.originLongitude)}>
                      <Input
                        value={settings.originAddress ?? ''}
                        onChange={(e) => setSettings({ ...settings, originAddress: e.target.value })}
                        placeholder="Rua, número — bairro, cidade/UF"
                      />
                    </Field>
                  )}
                </div>

                <div className="space-y-3">
                  <Field label="Destino">
                    <Select value={settings.destinationType} onChange={(e) => setSettings({ ...settings, destinationType: e.target.value })}>
                      <option value="NONE">Nenhum — termina na última visita</option>
                      <option value="HOME">Casa</option>
                      <option value="OFFICE">Escritório</option>
                      <option value="MANUAL">Endereço manual</option>
                    </Select>
                  </Field>
                  {settings.destinationType !== 'NONE' && (
                    <Field label="Endereço de destino" hint={coordinateHint(settings.destinationLatitude, settings.destinationLongitude)}>
                      <Input
                        value={settings.destinationAddress ?? ''}
                        onChange={(e) => setSettings({ ...settings, destinationAddress: e.target.value })}
                        placeholder="Rua, número — bairro, cidade/UF"
                      />
                    </Field>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Pesos do score</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Definem o que o motor considera uma rota boa. Peso maior = o motor evita mais
                  aquele problema. Isso é configuração, não código.
                </p>
              </div>

              <div className="space-y-3">
                {WEIGHT_FIELDS.map((field) => (
                  <div key={field.key}>
                    <div className="flex items-baseline justify-between">
                      <label className="text-xs font-medium text-ink-700">{field.label}</label>
                      <span className="tabular text-xs font-semibold text-ink-900">
                        {weights[field.key].toFixed(1).replace('.', ',')}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={field.max}
                      step={field.step}
                      value={weights[field.key]}
                      onChange={(e) => setWeights({ ...weights, [field.key]: Number(e.target.value) })}
                      className="mt-1.5 w-full accent-brand-600"
                    />
                    <p className="mt-0.5 text-[11px] text-ink-400">{field.hint}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'whatsapp' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <Switch
                checked={settings.whatsappEnabled}
                onChange={(value) => setSettings({ ...settings, whatsappEnabled: value })}
                label="Enviar o roteiro do dia pelo WhatsApp"
                description="O envio acontece na nuvem, sem depender de computador ligado."
              />

              <div className={cn('space-y-4', !settings.whatsappEnabled && 'pointer-events-none opacity-50')}>
                <div className="grid gap-4 border-t border-ink-200 pt-4 sm:grid-cols-2">
                  <Field label="Número" hint="Com DDI e DDD. Ex.: 5511988887766">
                    <Input
                      value={settings.whatsappNumber ?? ''}
                      onChange={(e) => setSettings({ ...settings, whatsappNumber: e.target.value })}
                      className="tabular"
                    />
                  </Field>
                  <Field label="Horário de envio">
                    <Input
                      type="time"
                      value={settings.whatsappTime}
                      onChange={(e) => setSettings({ ...settings, whatsappTime: e.target.value })}
                    />
                  </Field>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-ink-700">Dias de envio</p>
                  <div className="flex gap-2">
                    {WEEKDAYS.map((day) => (
                      <button
                        key={day.value}
                        onClick={() => toggleWhatsappDay(day.value)}
                        title={day.label}
                        className={cn(
                          'flex size-9 items-center justify-center rounded-lg text-xs font-semibold transition-all',
                          settings.whatsappDays.includes(day.value)
                            ? 'bg-brand-600 text-white'
                            : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                        )}
                      >
                        {day.short}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-400">
                    Feriados e dias bloqueados nunca recebem mensagem, mesmo que o dia da semana
                    esteja marcado.
                  </p>
                </div>

                <div className="space-y-2.5 border-t border-ink-200 pt-4">
                  <p className="text-xs font-medium text-ink-700">O que enviar</p>
                  <Switch checked={settings.whatsappIncludeRoute} onChange={(v) => setSettings({ ...settings, whatsappIncludeRoute: v })} label="Roteiro (lista de clínicas)" />
                  <Switch checked={settings.whatsappIncludeTimes} onChange={(v) => setSettings({ ...settings, whatsappIncludeTimes: v })} label="Horários estimados" />
                  <Switch checked={settings.whatsappIncludeDistance} onChange={(v) => setSettings({ ...settings, whatsappIncludeDistance: v })} label="Resumo de distância e tempo" />
                  <Switch checked={settings.whatsappIncludeMapLink} onChange={(v) => setSettings({ ...settings, whatsappIncludeMapLink: v })} label="Link do mapa" />
                </div>
              </div>
            </CardContent>
          </Card>

          {props.recentMessages.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-ink-200 px-5 py-3">
                <p className="text-sm font-semibold text-ink-900">Últimas mensagens</p>
              </div>
              <ul className="divide-y divide-ink-100">
                {props.recentMessages.map((message) => (
                  <li key={message.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular text-xs text-ink-600">
                        {new Date(message.scheduledFor).toLocaleString('pt-BR')}
                      </span>
                      <Badge
                        tone={
                          message.status === 'SENT' ? 'positive'
                            : message.status === 'FAILED' ? 'danger'
                            : message.status === 'SKIPPED' ? 'warning'
                            : 'neutral'
                        }
                      >
                        {STATUS_LABEL[message.status] ?? message.status}
                      </Badge>
                    </div>
                    {message.error && <p className="mt-1 text-[11px] text-ink-500">{message.error}</p>}
                    <pre className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap rounded bg-ink-50 p-2 font-sans text-[10px] leading-relaxed text-ink-500">
                      {message.body.slice(0, 300)}
                    </pre>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'integracoes' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">Serviços externos</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Todas as chaves ficam no servidor, nunca no navegador. O produto funciona sem
                  nenhuma delas — apenas com menos precisão ou sem envio automático.
                </p>
              </div>

              <ProviderRow
                icon={<MapPin className="size-4" strokeWidth={1.75} />}
                name="Google Maps Platform"
                configured={props.providerStatus.maps}
                configuredText="Geocodificação e rotas reais, com trânsito."
                fallbackText="Sem chave: distâncias e tempos são estimativas geométricas calibradas, e a geocodificação fica indisponível."
                envVar="GOOGLE_MAPS_API_KEY"
              />
              <ProviderRow
                icon={<Sparkles className="size-4" strokeWidth={1.75} />}
                name="Claude"
                configured={props.providerStatus.claude}
                configuredText="Análise contextual das rotas e do mês."
                fallbackText="Sem chave: o planejamento funciona igual, apenas sem os textos de análise."
                envVar="ANTHROPIC_API_KEY"
              />
              <ProviderRow
                icon={<MessageCircle className="size-4" strokeWidth={1.75} />}
                name="WhatsApp Cloud API"
                configured={props.providerStatus.whatsapp}
                configuredText="Envio automático do roteiro no horário configurado."
                fallbackText="Sem credenciais: as mensagens são geradas e ficam registradas no outbox, mas não são enviadas."
                envVar="WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const WEIGHT_FIELDS: Array<{
  key: keyof ScoreWeights;
  label: string;
  hint: string;
  max: number;
  step: number;
}> = [
  { key: 'duration', label: 'Tempo de deslocamento', hint: 'Por minuto rodado.', max: 5, step: 0.1 },
  { key: 'distance', label: 'Distância', hint: 'Por quilômetro rodado.', max: 5, step: 0.1 },
  { key: 'backtracking', label: 'Inversões de sentido', hint: 'Penaliza voltar por onde veio.', max: 40, step: 1 },
  { key: 'detour', label: 'Desvios', hint: 'Penaliza rodar além do caminho direto.', max: 10, step: 0.1 },
  { key: 'concentration', label: 'Concentração geográfica', hint: 'Prefere dias com clínicas próximas entre si.', max: 10, step: 0.1 },
  { key: 'balance', label: 'Equilíbrio da agenda', hint: 'Penaliza dias muito cheios ou muito vazios.', max: 20, step: 0.5 },
];

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Na fila',
  SENDING: 'Enviando',
  SENT: 'Enviada',
  FAILED: 'Falhou',
  SKIPPED: 'Não enviada',
};

function ProviderRow({
  icon,
  name,
  configured,
  configuredText,
  fallbackText,
  envVar,
}: {
  icon: React.ReactNode;
  name: string;
  configured: boolean;
  configuredText: string;
  fallbackText: string;
  envVar: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-ink-200 p-3.5">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          configured ? 'bg-[var(--color-positive-soft)] text-[var(--color-positive)]' : 'bg-ink-100 text-ink-400',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-ink-900">{name}</p>
          <Badge tone={configured ? 'positive' : 'neutral'}>
            {configured ? 'Configurado' : 'Não configurado'}
          </Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
          {configured ? configuredText : fallbackText}
        </p>
        {!configured && (
          <code className="mt-1 inline-block rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
            {envVar}
          </code>
        )}
      </div>
    </div>
  );
}

function coordinateHint(lat: number | null, lng: number | null): string {
  return lat !== null && lng !== null
    ? `Localizado em ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : 'Será localizado automaticamente ao salvar.';
}
