'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { Copy } from '../copy';
import type { Holiday, Trend, Locale } from '../contracts';
import { calendarAction } from './actions';
import { confirmation } from '../server/validation';
import styles from './calendar-extras.module.css';
type Data = { countries: string[]; keywords: string[]; holidays: Holiday[]; items: Trend[]; coverage: Array<{ country: string; year: number; count: number; fetchedAt: Date }> };
export function TrendPanels({ data, copy: c, locale, workspaceId, canWrite }: { data: Data; copy: Copy; locale: Locale; workspaceId: string; canWrite: boolean }) {
 const [keywords, setKeywords] = useState(data.keywords.join(', '));
 const [status, setStatus] = useState('');
 const router = useRouter();
 const [ask, dialog] = useConfirm({ title: c.review, cancel: c.cancel, confirm: c.save, danger: false });
 const regions = new Intl.DisplayNames([locale], { type: 'region' });
 const country = (value: string) => regions.of(value) ?? value;
 const date = (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : value);
 async function submit(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const values = keywords.split(',').map(k => k.trim()).filter(Boolean);
  const exact = confirmation('trends', 'update', workspaceId);
  await ask(c.keywordsHint, { exactConfirmation: exact, confirmationLabel: c.confirmation, pendingLabel: c.saving, failureLabel: c.failure, onConfirm: async () => {
   const result = await calendarAction('trends', { operation: 'update', id: workspaceId, data: { keywords: values }, confirmation: exact });
   if (!result.ok) return result.error;
   if (result.receipt.confirmed !== true || result.receipt.id !== workspaceId || result.receipt.area !== 'trends' || result.receipt.operation !== 'update') return c.failure;
   setStatus(c.saved); router.refresh(); return null;
  } });
 }
 const safeUrl = (value: string | null) => { try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
 return <>
  <details className={styles.panel}><summary>{c.keywords}</summary><p className={styles.meta}>{c.keywordsHint}</p><form className={styles.form} onSubmit={submit}><label className="ui-field"><span>{c.keywords}</span><input className="ui-input" name="keywords" autoComplete="off" value={keywords} disabled={!canWrite} onChange={e => setKeywords(e.target.value)} /></label>{canWrite && <Button type="submit">{c.save}</Button>}</form>{status && <p role="status">{status}</p>}</details>
  <div className={styles.columns}>
   <section className={styles.panel}><h2>{c.holidays}</h2>{data.holidays.length ? <ul className={styles.agenda}>{data.holidays.map(h => <li className={styles.row} key={`${h.country}:${h.date}:${h.name}`}><time dateTime={h.date}>{date(h.date)}</time><div><h3>{locale === 'fr' ? h.localName || h.name : h.name}</h3><p className={styles.meta}>{country(h.country)}</p></div></li>)}</ul> : <p className={styles.meta}>{c.noMatches}</p>}
    {data.countries.filter(code => !data.coverage.some(row => row.country === code && row.count > 0)).map(code => <p key={code} className={styles.meta}>{c.noCoverage} {country(code)}</p>)}
   </section>
   <section className={styles.panel}><h2>{c.searches}</h2>{data.items.length ? <ul className={styles.agenda}>{data.items.map(t => { const url = safeUrl(t.newsUrl); return <li className={styles.topic} key={t.id}><div><h3>{t.title}</h3><p className={styles.meta}>{country(t.country)}{t.traffic ? ` · ${t.traffic}` : ''}</p>{t.newsTitle && (url ? <a href={url} target="_blank" rel="noopener noreferrer">{t.newsTitle}</a> : <p>{t.newsTitle}</p>)}<p className={styles.meta}>{c.fresh} {date(new Date(t.fetchedAt))}</p></div></li>; })}</ul> : <p className={styles.meta}>{c.trendEmpty}</p>}</section>
  </div>{dialog}
 </>;
}
