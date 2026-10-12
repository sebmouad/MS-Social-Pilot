'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import type { AiSpendView, ModelPrice } from '@/lib/ai-prices';
import { Icon } from './Icon';

export interface SettingView {
  key: string;
  group: string;
  type: string;
  label: string;
  description: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  workerRestart: boolean;
  source: 'database' | 'environment' | 'default';
  value?: string | number | boolean | string[];
  hasValue: boolean;
  isSecret: boolean;
  defaultValue?: string | number | boolean | string[];
  envVar?: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

type Draft = Record<string, unknown>;

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * The configuration screen.
 *
 * Every field is generated from the settings registry, so a tunable cannot
 * exist in the code and be missing here — adding one to the registry adds it to
 * this form, its validation and its API in the same commit.
 *
 * Three things the screen has to be honest about, because getting them wrong
 * wastes an operator's afternoon:
 *
 * - **Where the current value comes from.** "Default", "from the environment"
 *   and "someone set this" behave identically today and differently the next
 *   time the default changes or the `.env` is edited.
 * - **A secret is never displayed**, only whether one exists. Leaving the field
 *   blank keeps the existing value rather than clearing it, so a save does not
 *   silently wipe an API key nobody meant to touch.
 * - **What takes effect when.** The worker re-reads configuration on its own
 *   cycle, so an interval change lands within a minute rather than instantly.
 */
export function ConfigClient({
  settings,
  groupLabels,
  groupOrder,
  aiSpend,
}: {
  settings: SettingView[];
  groupLabels: Record<string, string>;
  groupOrder: string[];
  aiSpend?: AiSpendView;
}) {
  const t = useTranslations('config');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const byGroup = new Map<string, SettingView[]>();
    for (const entry of settings) {
      const bucket = byGroup.get(entry.group) ?? [];
      bucket.push(entry);
      byGroup.set(entry.group, bucket);
    }
    return groupOrder
      .filter((group) => byGroup.has(group))
      .map((group) => [group, byGroup.get(group)!] as const);
  }, [settings, groupOrder]);

  const dirty = Object.keys(draft).length;

  function set(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(values: Draft) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/root/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const body = (await response.json()) as { error?: string; changed?: number };
      if (!response.ok) throw new Error(body.error ?? tCommon('genericError'));

      setDraft({});
      setMessage(t('saved', { count: body.changed ?? 0 }));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const sourceBadge = (entry: SettingView) => {
    const tone =
      entry.source === 'database'
        ? 'bg-brand-50 text-brand-700'
        : entry.source === 'environment'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-600';
    return (
      <span className={`badge ${tone}`} title={entry.envVar ? `${entry.envVar}` : undefined}>
        {t(`source.${entry.source}`)}
      </span>
    );
  };

  const fromEnvironment = settings.filter((entry) => entry.source === 'environment');

  async function adopt() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/root/config/adopt', { method: 'POST' });
      const body = (await response.json()) as { error?: string; moved?: number; invalid?: number };
      if (!response.ok) throw new Error(body.error ?? tCommon('genericError'));
      setMessage(t('adopted', { count: body.moved ?? 0 }));
      if (body.invalid) setError(t('adoptInvalid', { count: body.invalid }));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {fromEnvironment.length > 0 && (
        <section className="card space-y-3 border-s-4 border-amber-400 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('envTitle', { count: fromEnvironment.length })}</h2>
          <p className="text-sm text-slate-600">{t('envHint')}</p>
          <p className="break-words font-mono text-xs text-slate-600">
            {fromEnvironment.map((entry) => entry.envVar).join(' · ')}
          </p>
          <button type="button" className="btn-secondary" disabled={saving} onClick={adopt}>
            <Icon name="download" size={14} /> {saving ? t('adopting') : t('adopt')}
          </button>
        </section>
      )}
      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Icon name="error" /> {error}
        </p>
      )}
      {message && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Icon name="check" /> {message}
        </p>
      )}

      {grouped.map(([group, entries]) => (
        <section key={group} className="card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon name={groupIcon(group)} className="text-slate-400" />
            {groupLabels[group] ?? group}
          </h2>

          <div className="mt-4 divide-y divide-slate-100">
            {entries.map((entry) => {
              const current = draft[entry.key];
              const editing = entry.key in draft;

              return (
                <div key={entry.key} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={entry.key} className="text-sm font-medium text-slate-900">
                        {entry.label}
                      </label>
                      {sourceBadge(entry)}
                      {entry.workerRestart && (
                        <span className="badge bg-slate-100 text-slate-600">
                          <Icon name="clock" size={12} /> {t('workerLag')}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-sm text-slate-600">{entry.description}</p>
                    {entry.hint && <p className="mt-1 text-xs text-slate-500">{entry.hint}</p>}

                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      {entry.key}
                      {entry.envVar && ` · ${entry.envVar}`}
                      {entry.updatedBy && ` · ${t('changedBy', { name: entry.updatedBy })}`}
                    </p>
                  </div>

                  <div className="space-y-1">
                    {entry.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          id={entry.key}
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={Boolean(editing ? current : entry.value)}
                          onChange={(event) => set(entry.key, event.target.checked)}
                        />
                        {Boolean(editing ? current : entry.value) ? t('on') : t('off')}
                      </label>
                    ) : entry.type === 'select' ? (
                      <select
                        id={entry.key}
                        className="input"
                        value={asText(editing ? current : entry.value)}
                        onChange={(event) => set(entry.key, event.target.value)}
                      >
                        {entry.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : entry.type === 'secret' ? (
                      <div className="flex gap-1">
                        <input
                          id={entry.key}
                          type={revealed[entry.key] ? 'text' : 'password'}
                          className="input"
                          autoComplete="new-password"
                          placeholder={entry.hasValue ? t('secretSet') : t('secretUnset')}
                          value={asText(current)}
                          onChange={(event) => set(entry.key, event.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            setRevealed((value) => ({ ...value, [entry.key]: !value[entry.key] }))
                          }
                        >
                          <span className="sr-only">{t('reveal')}</span>
                          <Icon name={revealed[entry.key] ? 'eyeOff' : 'eye'} />
                        </button>
                      </div>
                    ) : entry.type === 'number' ? (
                      <input
                        id={entry.key}
                        type="number"
                        className="input"
                        min={entry.min}
                        max={entry.max}
                        value={asText(editing ? current : entry.value)}
                        onChange={(event) => set(entry.key, event.target.value)}
                      />
                    ) : entry.key === 'ai.model' ? (
                      <AiModelPicker
                        id={entry.key}
                        value={asText(editing ? current : entry.value)}
                        onChange={(value) => set(entry.key, value)}
                      />
                    ) : (
                      <input
                        id={entry.key}
                        type="text"
                        className="input"
                        value={asText(editing ? current : entry.value)}
                        onChange={(event) => set(entry.key, event.target.value)}
                      />
                    )}

                    {entry.type === 'list' && <p className="hint">{t('listHint')}</p>}
                    {entry.type === 'secret' && entry.hasValue && (
                      <p className="hint">{t('secretKeepHint')}</p>
                    )}
                    {entry.type === 'number' && entry.min !== undefined && (
                      <p className="hint">
                        {t('range', { min: entry.min, max: entry.max ?? '∞' })}
                      </p>
                    )}

                    {entry.source === 'database' && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={saving}
                        onClick={() => submit({ [entry.key]: null })}
                      >
                        <Icon name="refresh" size={14} /> {t('reset')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {group === 'email' && <TestEmailButton />}
          {group === 'ai' && aiSpend && <AiSpendPanel spend={aiSpend} />}
        </section>
      ))}

      {/* A sticky bar rather than a button at the bottom of a very long form:
          the field someone just changed is rarely near the end of it. */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <p className="text-sm text-slate-600">
          {dirty > 0 ? t('unsaved', { count: dirty }) : t('noChanges')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={dirty === 0 || saving}
            onClick={() => setDraft({})}
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={dirty === 0 || saving}
            onClick={() => submit(draft)}
          >
            {saving ? tCommon('working') : tCommon('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupIcon(group: string) {
  const map: Record<string, Parameters<typeof Icon>[0]['name']> = {
    general: 'settings',
    facebook: 'facebook',
    features: 'sparkles',
    scheduler: 'clock',
    analytics: 'analytics',
    ai: 'sparkles',
    email: 'bell',
    links: 'link',
    media: 'image',
  };
  return map[group] ?? 'config';
}

interface AiModelOption {
  id: string;
  label: string;
  price?: ModelPrice | null;
}

/**
 * The model field, filled from the provider's own list (never a list in the
 * code). Blank keeps "the newest model", so a new release is picked up without
 * anyone editing this screen.
 */
function AiModelPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('config');
  const usd = useUsd();
  const [models, setModels] = useState<AiModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(refresh: boolean) {
    setLoading(true);
    try {
      const response = await fetch(`/api/root/config/ai-models${refresh ? '?refresh=1' : ''}`);
      const body = (await response.json()) as { models?: AiModelOption[]; error?: string | null };
      setModels(body.models ?? []);
      setError(response.ok ? (body.error ?? null) : 'unreachable');
    } catch {
      setModels([]);
      setError('unreachable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const known = models?.some((model) => model.id === value) ?? true;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t('aiModelNewest')}</option>
          {value && !known && <option value={value}>{t('aiModelNotListed', { id: value })}</option>}
          {models?.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} ({model.id}) ·{' '}
              {model.price
                ? t('aiPrice', { input: usd(model.price.input), output: usd(model.price.output) })
                : t('aiPriceUnknown')}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost" disabled={loading} onClick={() => void load(true)}>
          <span className="sr-only">{t('aiModelRefresh')}</span>
          <Icon name="refresh" />
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {loading
          ? t('aiModelLoading')
          : error === 'keyRejected'
            ? t('aiModelKeyRejected')
            : error
              ? t('aiModelUnreachable')
              : models && models.length === 0
                ? t('aiModelNoKey')
                : t('aiModelCount', { count: models?.length ?? 0 })}
      </p>
    </div>
  );
}

/**
 * Sends one message with the saved settings and reports the server's answer,
 * so a wrong app password shows up here rather than as a missing alert later.
 */
function TestEmailButton() {
  const t = useTranslations('config');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const response = await fetch('/api/root/config/test-email', { method: 'POST' });
      const body = (await response.json()) as { status?: string; error?: string | null; to?: string };
      if (body.status === 'sent') setResult({ ok: true, text: t('testEmailSent', { to: body.to ?? '' }) });
      else if (body.status === 'skipped') setResult({ ok: false, text: t('testEmailNoProvider') });
      else setResult({ ok: false, text: t('testEmailFailed', { reason: body.error ?? '' }) });
    } catch {
      setResult({ ok: false, text: t('testEmailFailed', { reason: '' }) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      <button type="button" className="btn-secondary" disabled={sending} onClick={() => void send()}>
        <Icon name="mail" size={14} /> {sending ? t('testEmailSending') : t('testEmail')}
      </button>
      <p className="hint">{t('testEmailHint')}</p>
      {result && (
        <p
          role="status"
          className={`w-full text-sm ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}

/** Dollars with cents, or more digits for the fractions of a cent one caption costs. */
function useUsd() {
  const format = useFormatter();
  return (value: number) =>
    format.number(value, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 4 : 2,
    });
}

/**
 * What AI has cost: this month against the budget, then the last 30 days by
 * model and by workspace. A model with no known price says so and points at
 * the price field instead of showing $0, which would look like free.
 */
function AiSpendPanel({ spend }: { spend: AiSpendView }) {
  const t = useTranslations('config');
  const format = useFormatter();
  const usd = useUsd();
  const unpriced = spend.byModel.reduce((sum, row) => sum + row.unpriced, 0);
  const generations = spend.byModel.reduce((sum, row) => sum + row.generations, 0);
  const used = spend.budgetUsd > 0 ? Math.min(100, Math.round((spend.monthUsd / spend.budgetUsd) * 100)) : null;

  return (
    <div className="mt-2 space-y-4 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('aiSpendTitle')}</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t('aiSpendMonth')}</p>
          <p className="text-lg font-semibold text-slate-900">{usd(spend.monthUsd)}</p>
          <p className="text-xs text-slate-500">
            {used === null ? t('aiSpendNoBudget') : t('aiSpendOfBudget', { budget: usd(spend.budgetUsd), percent: used })}
          </p>
          {used !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
              <div
                className={`h-full rounded-full ${used >= 100 ? 'bg-red-500' : used >= 80 ? 'bg-amber-500' : 'bg-brand-600'}`}
                style={{ width: `${used}%` }}
              />
            </div>
          )}
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t('aiSpend30')}</p>
          <p className="text-lg font-semibold text-slate-900">{usd(spend.last30Usd)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t('aiSpendGenerations')}</p>
          <p className="text-lg font-semibold text-slate-900">{format.number(generations)}</p>
        </div>
      </div>

      {unpriced > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Icon name="error" size={14} className="mt-0.5 shrink-0" /> {t('aiSpendUnpriced', { count: unpriced })}
        </p>
      )}

      {generations === 0 ? (
        <p className="text-sm text-slate-600">{t('aiSpendEmpty')}</p>
      ) : (
        <>
          <div className="scroll-x">
            <table className="data-table w-full min-w-[32rem] text-start text-sm tabular-nums">
              <caption className="sr-only">{t('aiSpendByModel')}</caption>
              <thead>
                <tr>
                  <th className="py-1 pe-3 font-medium">{t('aiSpendModel')}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t('aiSpendGenerationsShort')}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t('aiSpendTokens')}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t('aiSpendCost')}</th>
                  <th className="py-1 text-end font-medium">{t('aiSpendPerGeneration')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {spend.byModel.map((row) => {
                  const priced = row.generations - row.unpriced;
                  return (
                    <tr key={`${row.provider}:${row.model}`}>
                      <td className="py-1.5 pe-3">
                        <span className="font-mono text-xs text-slate-900" translate="no">{row.model}</span>
                        {row.provider && <span className="ms-1 text-xs text-slate-500">· {row.provider}</span>}
                      </td>
                      <td className="py-1.5 pe-3 text-end">{format.number(row.generations)}</td>
                      <td className="py-1.5 pe-3 text-end text-slate-600">
                        {format.number(row.inputTokens)} / {format.number(row.outputTokens)}
                      </td>
                      <td className="py-1.5 pe-3 text-end">
                        {priced > 0 ? usd(row.costUsd) : <span className="text-amber-700">{t('aiPriceUnknown')}</span>}
                      </td>
                      <td className="py-1.5 text-end text-slate-600">{priced > 0 ? usd(row.costUsd / priced) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="scroll-x">
            <table className="data-table w-full min-w-[20rem] text-start text-sm tabular-nums">
              <caption className="sr-only">{t('aiSpendByWorkspace')}</caption>
              <thead>
                <tr>
                  <th className="py-1 pe-3 font-medium">{t('aiSpendWorkspace')}</th>
                  <th className="py-1 pe-3 text-end font-medium">{t('aiSpendGenerationsShort')}</th>
                  <th className="py-1 text-end font-medium">{t('aiSpendCost')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {spend.byWorkspace.map((row) => (
                  <tr key={row.workspaceId}>
                    <td className="py-1.5 pe-3 text-slate-900">{row.name}</td>
                    <td className="py-1.5 pe-3 text-end">{format.number(row.generations)}</td>
                    <td className="py-1.5 text-end">
                      {usd(row.costUsd)}
                      {row.unpriced > 0 && (
                        <span className="ms-1 text-xs text-amber-700">{t('aiSpendPlusUnpriced', { count: row.unpriced })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="hint">{t('aiSpendFootnote')}</p>
    </div>
  );
}
