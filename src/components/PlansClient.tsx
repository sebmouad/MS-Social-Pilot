'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PLAN_FEATURES } from '@/lib/product-catalog';

const FEATURES = PLAN_FEATURES.filter((feature) => feature !== 'product_v2');
const LIMITS = ['channels', 'members', 'workspaces', 'postsPerMonth', 'aiCredits'] as const;
const PRICES = ['priceMonthly', 'priceYearly', 'extraChannelPrice'] as const;

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  currency: string;
  priceMonthly: number;
  priceYearly: number;
  extraChannelPrice: number;
  channels: number | null;
  members: number | null;
  workspaces: number | null;
  postsPerMonth: number | null;
  aiCredits: number | null;
  features: string[];
  isDefault: boolean;
}

interface Subscriber {
  id: string;
  name: string;
  email: string;
  root: boolean;
  planId: string | null;
  extraChannels: number;
  usage: { channels: number; members: number; workspaces: number };
  limits: { channels: number | null; members: number | null; workspaces: number | null };
}

/** Prices are typed in units and stored in cents; an empty limit is unlimited. */
export function PlansClient({ plans, subscribers }: { plans: PlanRow[]; subscribers: Subscriber[] }) {
  const t = useTranslations('root.plans');
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(url: string, body: unknown) {
    setMessage(null);
    const response = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setMessage({ ok: false, text: payload?.error ?? t('failed') });
      return;
    }
    setMessage({ ok: true, text: t('saved') });
    router.refresh();
  }

  function savePlan(event: React.FormEvent<HTMLFormElement>, plan: PlanRow) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const number = (key: string) => {
      const raw = String(form.get(key) ?? '').trim();
      return raw === '' ? null : Math.round(Number(raw));
    };
    void send(`/api/root/plans/${plan.id}`, {
      name: String(form.get('name') ?? plan.name),
      currency: String(form.get('currency') ?? plan.currency),
      ...Object.fromEntries(PRICES.map((key) => [key, Math.round(Number(form.get(key) ?? 0) * 100)])),
      ...Object.fromEntries(LIMITS.map((key) => [key, number(key)])),
      features: ['product_v2', ...FEATURES.filter((feature) => form.get(`feature_${feature}`) === 'on')],
      isDefault: form.get('isDefault') === 'on',
    });
  }

  const usage = (used: number, limit: number | null) => (limit === null ? `${used} / ∞` : `${used} / ${limit}`);

  return (
    <div className="space-y-6">
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={t('plansTitle')}>
        {plans.map((plan) => (
          <form key={plan.id} onSubmit={(event) => savePlan(event, plan)} className="card space-y-3 p-4" aria-label={plan.name}>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <label className="text-xs text-slate-600">
                {t('name')}
                <input name="name" className="input mt-1" defaultValue={plan.name} required />
              </label>
              <label className="text-xs text-slate-600">
                {t('currency')}
                <input name="currency" className="input mt-1" defaultValue={plan.currency} maxLength={3} required />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PRICES.map((key) => (
                <label key={key} className="text-xs text-slate-600">
                  {t(key)}
                  <input name={key} type="number" min={0} step="0.01" className="input mt-1" defaultValue={plan[key] / 100} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LIMITS.map((key) => (
                <label key={key} className="text-xs text-slate-600">
                  {t(key)}
                  <input name={key} type="number" min={0} className="input mt-1" placeholder="∞" defaultValue={plan[key] ?? ''} />
                </label>
              ))}
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs font-semibold text-slate-700">{t('features')}</legend>
              {FEATURES.map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name={`feature_${feature}`} defaultChecked={feature.includes('/') ? !plan.features.includes('product_v2') || plan.features.includes(feature) : plan.features.includes(feature)} className="h-4 w-4 rounded border-slate-300" />
                  {t(`feature_${feature.replace('/', '_')}`)}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="isDefault" defaultChecked={plan.isDefault} className="h-4 w-4 rounded border-slate-300" />
                {t('isDefault')}
              </label>
            </fieldset>
            <button type="submit" className="btn-primary w-full">{t('save', { plan: plan.name })}</button>
          </form>
        ))}
      </section>

      <section className="card p-4" aria-labelledby="subscribers-title">
        <h2 id="subscribers-title" className="text-[15px] font-semibold text-slate-900">{t('subscribersTitle')}</h2>
        <p className="mt-1 text-xs text-slate-600">{t('subscribersHint')}</p>
        <div className="scroll-x mt-3">
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-slate-500">
                <th className="py-2 pe-3 font-medium">{t('subscriber')}</th>
                <th className="py-2 pe-3 font-medium">{t('plan')}</th>
                <th className="py-2 pe-3 font-medium">{t('extraChannels')}</th>
                <th className="py-2 pe-3 font-medium">{t('channels')}</th>
                <th className="py-2 pe-3 font-medium">{t('members')}</th>
                <th className="py-2 font-medium">{t('workspaces')}</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="py-2 pe-3">
                    <span className="font-medium text-slate-900">{user.name}</span>
                    <span className="block text-xs text-slate-500">{user.email}{user.root ? ` · ${t('rootUnlimited')}` : ''}</span>
                  </td>
                  <td className="py-2 pe-3">
                    <select
                      aria-label={t('planFor', { name: user.name })}
                      className="input"
                      defaultValue={user.planId ?? ''}
                      onChange={(event) => void send(`/api/root/subscribers/${user.id}`, { planId: event.target.value || null })}
                    >
                      <option value="">{t('noPlan')}</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>{plan.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pe-3">
                    <input
                      type="number"
                      min={0}
                      aria-label={t('extraFor', { name: user.name })}
                      className="input w-20"
                      defaultValue={user.extraChannels}
                      onBlur={(event) => {
                        const value = Math.max(0, Math.round(Number(event.target.value) || 0));
                        if (value !== user.extraChannels) void send(`/api/root/subscribers/${user.id}`, { extraChannels: value });
                      }}
                    />
                  </td>
                  <td className="nums py-2 pe-3">{usage(user.usage.channels, user.limits.channels)}</td>
                  <td className="nums py-2 pe-3">{usage(user.usage.members, user.limits.members)}</td>
                  <td className="nums py-2">{usage(user.usage.workspaces, user.limits.workspaces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
