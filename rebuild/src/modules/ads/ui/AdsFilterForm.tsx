'use client';
import { useId, useState } from 'react';
import { isAdsReportDay, type AdsFilterErrors } from '@/modules/ads/report-filters';
import type { AdsReportPolicy } from '@/modules/ads/report-policy';
import { FilterPanel, FilterChips } from '@/components/FilterPanel';
import { Button } from '@/components/Button';

export type AdsFilterValues = { period: string; since: string; until: string; account: string };
export function AdsFilterForm({ accounts, values, errors = {}, action, policy }: {
  accounts: Array<{ id: string; name: string }>; values: AdsFilterValues; errors?: AdsFilterErrors; action: string; policy: AdsReportPolicy;
}) {
  const id = useId().replace(/:/g, '');
  const [period, setPeriod] = useState(values.period);
  const field = (key: keyof AdsFilterValues) => ({ 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined });
  const error = (key: keyof AdsFilterValues) => errors[key] ? <span className="ui-field-error" id={`${id}-${key}-error`}>{errors[key]}</span> : null;
  const custom = period === 'custom';
  const unknownPeriod = !policy.presets.some(item => item.id === period) && !custom;
  const unknownAccount = values.account !== 'all' && !accounts.some(account => account.id === values.account);
  return <form noValidate action={action} method="get" className="ads-sidebar-filter">
    <FilterPanel title="Filters" activeCount={Object.values(values).filter(Boolean).length} onReset={() => window.location.assign(action)} summary={<FilterChips filters={Object.entries(values).filter(([, value]) => value && value !== 'all').map(([key, value]) => ({ key, label: ({ period: 'Date range', since: 'From', until: 'To', account: 'Account' } as Record<string, string>)[key]!, value: key === 'account' ? accounts.find(account => account.id === value)?.name ?? value : key === 'period' ? policy.presets.find(preset => preset.id === value)?.label ?? value : value }))} onRemove={key => {
      const params = new URLSearchParams(values);
      params.delete(key);
      if (key === 'since' || key === 'until' || key === 'period') { params.delete('since'); params.delete('until'); params.delete('period'); }
      window.location.assign(`${action}?${params}`);
    }} />}>

    <div className="ads-filter-field"><label className="ui-field"><span>Date range</span><select className="ui-input" name="period" value={period} onChange={event => setPeriod(event.target.value)} {...field('period')}>
      {unknownPeriod ? <option value={period}>Unavailable date range</option> : null}
      {policy.presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="custom">Custom dates</option>
    </select></label>{error('period')}</div>
    {(['since', 'until'] as const).map(key => <div className="ads-filter-field" key={key}><label className="ui-field"><span>{key === 'since' ? 'From' : 'To'}</span>
      <input className="ui-input" type={values[key] && !isAdsReportDay(values[key]) ? 'text' : 'date'} maxLength={values[key] && !isAdsReportDay(values[key]) ? policy.maxFilterCharacters : undefined} name={key} defaultValue={values[key]} disabled={!custom} required={custom} {...field(key)} />
    </label>{error(key)}</div>)}
    {!custom ? <p className="small-note">Choose Custom dates to edit this range. Custom ranges can include up to {policy.maxRangeDays} days.</p> : <p className="small-note">Custom ranges can include up to {policy.maxRangeDays} days.</p>}
    <div className="ads-filter-field"><label className="ui-field"><span>Ad account</span><select className="ui-input" name="account" defaultValue={values.account} {...field('account')}>
      {unknownAccount ? <option value={values.account}>Unavailable account</option> : null}
      <option value="all">All accounts</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>{error('account')}</div>
    <Button type="submit">Apply filters</Button>
    <a className="ads-filter-reset" href={action}>Reset filters</a>
  </FilterPanel></form>;
}
