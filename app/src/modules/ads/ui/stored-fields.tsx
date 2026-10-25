'use client';
import { storedFieldRows } from '../stored-fields';
import { useAdsCatalogs, useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

export { storedFieldRows };

export function StoredFields({ actions, fields }: { actions: unknown; fields: unknown }) {
  const t = useAdsText();
  const { locale } = useAdsCatalogs();
  const groups = [
    { title: t('dailyActions'), rows: storedFieldRows(actions, t, locale) },
    { title: t('additionalMeasures'), rows: storedFieldRows(fields, t, locale) },
  ];
  return <>{groups.map(group => <div className="ads-field-group" key={group.title}><h5>{group.title}</h5>{group.rows.length ? <dl>{group.rows.map((row, index) => <div key={`${row.label}:${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p>{t('text187')}</p>}</div>)}</>;
}
