'use client';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { loadPostExportLabels } from './export-actions';
import type { ASYNC_POST_EXPORT_COPY } from '../../server/export/config';

type Copy = Record<keyof typeof ASYNC_POST_EXPORT_COPY.en, string>;
type Receipt = { id: string; status: 'queued' | 'processing' | 'ready' | 'failed'; runs?: Array<{ attempt: number; outcome: string }> };
export function PostExport({ locale = 'en' }: { maxPosts: number; maxBytes: number; locale?: 'en' | 'fr' }) {
 const params = useSearchParams(); const labelId = useId();
 const [copy, setCopy] = useState<Copy | null>(null);
 const [confirmed, setConfirmed] = useState(false); const [job, setJob] = useState<Receipt | null>(null);
 const inFlight = useRef(false); const active = useRef(true);
 useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
 const [error, setError] = useState(false); const [pending, startTransition] = useTransition();
 useEffect(() => { let active = true; void loadPostExportLabels(locale).then(value => { if (active) setCopy(value); }, () => { if (active) setError(true); }); return () => { active = false; }; }, [locale]);
 if (!copy) return null;
 const run = (create: boolean) => {
  if (inFlight.current) return;
  inFlight.current = true;
  startTransition(async () => {
  setError(false);
  try {
   const filters = Object.fromEntries(['q','status','channel'].flatMap(key => { const value = params.get(key); return value ? [[key === 'channel' ? 'channelId' : key, value]] : []; }));
   const response = await fetch(create ? '/api/publishing/posts/export/jobs' : `/api/publishing/posts/export/jobs?action=status&id=${encodeURIComponent(job!.id)}`, create ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', filters, confirmation: confirmed ? 'EXPORT POSTS' : '' }) } : { cache: 'no-store' });
   if (!response.ok) throw new Error();
   const receipt = await response.json();
   if (typeof receipt.id !== 'string' || !['queued','processing','ready','failed'].includes(receipt.status)) throw new Error();
   if (active.current) { setJob(receipt); if (create) setConfirmed(false); }
  } catch { if (active.current) setError(true); } finally { inFlight.current = false; }
 });
 };
 return <section aria-labelledby={labelId} className="shell-subnav__group">
  <h3 id={labelId} className="shell-subnav__label"><IconDownload size={16} aria-hidden="true" /> {copy.title}</h3>
  <p>{copy.help}</p>
  <label><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /> {copy.confirm}</label>
  <Button variant="secondary" disabled={pending || !confirmed} onClick={() => run(true)}>{pending ? copy.pending : copy.prepare}</Button>
  {job ? <div aria-live="polite" aria-busy={pending}>
   <p>{copy[job.status]}</p>
   {job.status === 'ready' ? <a className="ui-button ui-button--secondary" href={`/api/publishing/posts/export/jobs?action=download&id=${encodeURIComponent(job.id)}`}><IconDownload size={16} aria-hidden="true" /> {copy.download}</a> : job.status !== 'failed' ? <Button variant="secondary" disabled={pending} onClick={() => run(false)}><IconRefresh size={16} aria-hidden="true" /> {copy.refresh}</Button> : null}
   {job.runs?.length ? <details><summary>{copy.history}</summary><ol>{job.runs.map(run => <li key={run.attempt}>{copy.attempt} {run.attempt}: {copy[run.outcome === 'failed' ? 'failedRun' : run.outcome as keyof Copy] ?? copy.failedRun}</li>)}</ol></details> : null}
  </div> : null}
  {error ? <p role="alert">{copy.failure}</p> : null}
 </section>;
}
