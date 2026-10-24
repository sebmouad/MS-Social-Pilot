'use client';
import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import { useId, useState } from 'react';
import { isAdsReportDay, type AdsFilterErrors } from '@/modules/ads/report-filters';
import type { AdsReportPolicy } from '@/modules/ads/report-policy';
import { FilterPanel, FilterChips } from '@/components/FilterPanel';
import { Button } from '@/components/Button';

export type AdsFilterValues = { period: string; since: string; until: string; account: string };
export function AdsFilterForm({ accounts, values, errors = {}, action, policy }: {
  accounts: Array<{ id: string; name: string }>; values: AdsFilterValues; errors?: AdsFilterErrors; action: string; policy: AdsReportPolicy;
}) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const id = useId().replace(/:/g, '');
  const [period, setPeriod] = useState(values.period);
  const field = (key: keyof AdsFilterValues) => ({ 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined });
  const error = (key: keyof AdsFilterValues) => errors[key] ? <span className="ui-field-error" id={`${id}-${key}-error`}>{localize(errors[key])}</span> : null;
  const custom = period === 'custom';
  const unknownPeriod = !policy.presets.some(item => item.id === period) && !custom;
  const unknownAccount = values.account !== 'all' && !accounts.some(account => account.id === values.account);
  return <form noValidate action={action} method="get" className="ads-sidebar-filter">
    <FilterPanel title={t('text080')} activeCount={Object.values(values).filter(Boolean).length} onReset={() => window.location.assign(action)} summary={<FilterChips filters={Object.entries(values).filter(([, value]) => value && value !== 'all').map(([key, value]) => ({ key, label: ({ period: t('text081'), since: t('text256'), until: t('text257'), account: t('text193') } as Record<string, string>)[key]!, value: key === 'account' ? accounts.find(account => account.id === value)?.name ?? value : key === 'period' ? policy.presets.find(preset => preset.id === value)?.label ?? value : value }))} onRemove={key => {
      const params = new URLSearchParams(values);
      params.delete(key);
      if (key === 'since' || key === 'until' || key === 'period') { params.delete('since'); params.delete('until'); params.delete('period'); }
      window.location.assign(`${action}?${params}`);
    }} />}>

    <div className="ads-filter-field"><label className="ui-field"><span>{t('text081')}</span><select className="ui-input" name="period" value={period} onChange={event => setPeriod(event.target.value)} {...field('period')}>
      {unknownPeriod ? <option value={period}>{t('text082')}</option> : null}
      {policy.presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="custom">{t('text083')}</option>
    </select></label>{error('period')}</div>
    {(['since', 'until'] as const).map(key => <div className="ads-filter-field" key={key}><label className="ui-field"><span>{key === 'since' ? t('text256') : t('text257')}</span>
      <input className="ui-input" type={values[key] && !isAdsReportDay(values[key]) ? 'text' : 'date'} maxLength={values[key] && !isAdsReportDay(values[key]) ? policy.maxFilterCharacters : undefined} name={key} defaultValue={values[key]} disabled={!custom} required={custom} {...field(key)} />
    </label>{error(key)}</div>)}
    {!custom ? <p className="small-note">{t('customRangeHelp', { days: policy.maxRangeDays })}</p> : <p className="small-note">{t('customRangeLimit', { days: policy.maxRangeDays })}</p>}
    <div className="ads-filter-field"><label className="ui-field"><span>{t('text044')}</span><select className="ui-input" name="account" defaultValue={values.account} {...field('account')}>
      {unknownAccount ? <option value={values.account}>{t('text087')}</option> : null}
      <option value="all">{t('text088')}</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>{error('account')}</div>
    <Button type="submit">{t('text089')}</Button>
    <a className="ads-filter-reset" href={action}>{t('text090')}</a>
  </FilterPanel></form>;
}
