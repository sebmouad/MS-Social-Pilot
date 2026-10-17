'use client';

import { useMemo, useState } from 'react';
import { planConfirmation, type PlanFeatureGroup } from '@/server/root/legacy/shared';
import { ConfirmAction } from './ConfirmAction';

export type PlanView = { id: string; key: string; name: string; currency: string; priceMonthly: number; priceYearly: number; extraChannelPrice: number; channels: number | null; members: number | null; workspaces: number | null; postsPerMonth: number | null; aiCredits: number | null; features: string[]; isDefault: boolean; unlistedFeatures: string[] };
const LIMITS = [['channels', 'Channels'], ['members', 'Members'], ['workspaces', 'Workspaces'], ['postsPerMonth', 'Posts per month'], ['aiCredits', 'AI credits']] as const;
const PRICES = [['priceMonthly', 'Monthly price (minor units)'], ['priceYearly', 'Yearly price (minor units)'], ['extraChannelPrice', 'Extra channel price']] as const;

export function PlanEditor({ plan, groups }: { plan: PlanView; groups: readonly PlanFeatureGroup[] }) {
  const [name, setName] = useState(plan.name);
  const [currency, setCurrency] = useState(plan.currency);
  const [numbers, setNumbers] = useState<Record<string, string>>(() => Object.fromEntries([...LIMITS, ...PRICES].map(([field]) => [field, plan[field] === null ? '' : String(plan[field])])));
  const [features, setFeatures] = useState(() => new Set(plan.features));
  const [isDefault, setDefault] = useState(plan.isDefault);

  const { patch, invalid } = useMemo(() => {
    const patch: Record<string, unknown> = {};
    let invalid = '';
    if (name.trim() !== plan.name) patch.name = name.trim();
    if (currency.trim().toUpperCase() !== plan.currency) patch.currency = currency.trim().toUpperCase();
    for (const [field] of PRICES) {
      const value = Number(numbers[field]);
      if (numbers[field] === '' || !Number.isInteger(value) || value < 0) invalid = 'Prices must be whole numbers, zero or more.';
      else if (value !== plan[field]) patch[field] = value;
    }
    for (const [field] of LIMITS) {
      const raw = numbers[field]!.trim();
      const value = raw === '' ? null : Number(raw);
      if (value !== null && (!Number.isInteger(value) || value < 0)) invalid = 'Limits must be whole numbers; leave blank for unlimited.';
      else if (value !== plan[field]) patch[field] = value;
    }
    const nextFeatures = [...features].sort();
    if (JSON.stringify(nextFeatures) !== JSON.stringify([...plan.features].sort())) patch.features = nextFeatures;
    if (isDefault !== plan.isDefault) patch.isDefault = isDefault;
    if (!name.trim() || currency.trim().length !== 3) invalid = 'Enter a plan name and a three-letter currency.';
    return { patch, invalid };
  }, [name, currency, numbers, features, isDefault, plan]);

  const changed = Object.keys(patch).length > 0;
  const phrase = patch.isDefault === true ? planConfirmation.makeDefault(plan.key) : planConfirmation.update(plan.key);
  const toggle = (key: string) => setFeatures(current => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });

  return <section className="root-ops__panel" aria-labelledby={`plan-${plan.id}`}>
    <h2 id={`plan-${plan.id}`}>{plan.name} <span className="root-ops__muted">({plan.key})</span></h2>
    <div className="root-ops__fields">
      <label className="ui-field"><span>Name</span><input className="ui-input" value={name} onChange={event => setName(event.target.value)} maxLength={60} /></label>
      <label className="ui-field"><span>Currency</span><input className="ui-input" value={currency} onChange={event => setCurrency(event.target.value)} maxLength={3} /></label>
      {PRICES.map(([field, label]) => <label key={field} className="ui-field"><span>{label}</span><input className="ui-input" inputMode="numeric" value={numbers[field]} onChange={event => setNumbers(current => ({ ...current, [field]: event.target.value }))} /></label>)}
      {LIMITS.map(([field, label]) => <label key={field} className="ui-field"><span>{label} (blank is unlimited)</span><input className="ui-input" inputMode="numeric" value={numbers[field]} onChange={event => setNumbers(current => ({ ...current, [field]: event.target.value }))} /></label>)}
    </div>
    <div className="root-ops__feature-groups">{groups.map(group => <fieldset key={group.id}><legend>{group.title}</legend>
      {group.features.map(feature => <label key={feature.key}><input type="checkbox" checked={features.has(feature.key)} onChange={() => toggle(feature.key)} />{feature.label}</label>)}
    </fieldset>)}</div>
    {plan.unlistedFeatures.length > 0 && <p className="root-ops__muted">Also on this plan, not in the module list: {plan.unlistedFeatures.join(', ')}. They are kept unless you clear them in the database.</p>}
    <label><input type="checkbox" checked={isDefault} onChange={event => setDefault(event.target.checked)} disabled={plan.isDefault} /> New sign-ups start on this plan{plan.isDefault ? ' (choose another plan to change the default)' : ''}</label>
    {invalid && <p role="alert" className="ui-error">{invalid}</p>}
    <div className="root-ops__actions">
      <ConfirmAction id={`plan-save-${plan.id}`} label="Save plan" title={`Save ${plan.name}?`} description="Limits and features apply to every account on this plan at its next check. Prices are shown to customers; nothing is charged." phrase={phrase} endpoint={`/api/root/plans/${encodeURIComponent(plan.id)}`} method="PATCH" body={{ patch }} variant="primary" successText="Plan saved." disabled={!changed || Boolean(invalid)} />
      {!changed && <span className="root-ops__muted">No changes yet.</span>}
    </div>
  </section>;
}
