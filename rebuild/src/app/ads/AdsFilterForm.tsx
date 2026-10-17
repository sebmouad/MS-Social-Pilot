'use client';
import { useId, useState } from 'react';
import { ADS_REPORT_PRESETS, isAdsReportDay, type AdsFilterErrors } from '@/modules/ads/report-filters';
import { Button } from '@/components/Button';

export type AdsFilterValues = { period: string; since: string; until: string; account: string };
export function AdsFilterForm({ accounts, values, errors = {}, action }: {
  accounts: Array<{ id: string; name: string }>; values: AdsFilterValues; errors?: AdsFilterErrors; action: string;
}) {
  const id = useId().replace(/:/g, '');
  const [period, setPeriod] = useState(values.period);
  const field = (key: keyof AdsFilterValues) => ({ 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined });
  const error = (key: keyof AdsFilterValues) => errors[key] ? <span className="ui-field-error" id={`${id}-${key}-error`}>{errors[key]}</span> : null;
  const custom = period === 'custom';
  const unknownPeriod = !ADS_REPORT_PRESETS.some(item => item.id === period) && !custom;
  const unknownAccount = values.account !== 'all' && !accounts.some(account => account.id === values.account);
  return <form noValidate action={action} method="get" className="ads-sidebar-filter">
    <p className="ads-filter-heading">Filters</p>
    <div className="ads-filter-field"><label className="ui-field"><span>Date range</span><select className="ui-input" name="period" value={period} onChange={event => setPeriod(event.target.value)} {...field('period')}>
      {unknownPeriod ? <option value={period}>Unavailable date range</option> : null}
      {ADS_REPORT_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="custom">Custom dates</option>
    </select></label>{error('period')}</div>
    {(['since', 'until'] as const).map(key => <div className="ads-filter-field" key={key}><label className="ui-field"><span>{key === 'since' ? 'From' : 'To'}</span>
      <input className="ui-input" type={values[key] && !isAdsReportDay(values[key]) ? 'text' : 'date'} name={key} defaultValue={values[key]} disabled={!custom} required={custom} {...field(key)} />
    </label>{error(key)}</div>)}
    {!custom ? <p className="small-note">Choose Custom dates to edit this range.</p> : null}
    <div className="ads-filter-field"><label className="ui-field"><span>Ad account</span><select className="ui-input" name="account" defaultValue={values.account} {...field('account')}>
      {unknownAccount ? <option value={values.account}>Unavailable account</option> : null}
      <option value="all">All accounts</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>{error('account')}</div>
    <Button type="submit">Apply filters</Button>
    <a className="ads-filter-reset" href={action}>Reset filters</a>
  </form>;
}
