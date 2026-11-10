'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconBrandGithub, IconCheck, IconCircleCheck, IconClockHour4, IconCloudDownload, IconCopy, IconFileText, IconHandClick, IconLoader2, IconReplace, IconTerminal2 } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { SegmentedControl } from '@/components/Forms';
import { useToast } from '@/components/Toast';
import { updatesCopyText, type RootUpdatesCopy } from '@/lib/config/root-updates-copy';

export type UpdateStatus = 'requested' | 'running' | 'succeeded' | 'failed' | 'superseded';
export type UpdateItem = { id: string; commit: string | null; branch: string; source: 'github' | 'root'; status: UpdateStatus; summary: string | null;
  deployedCommit: string | null; hasLog: boolean; createdAt: string; startedAt: string | null; finishedAt: string | null };
type Filter = 'all' | 'active' | 'done' | 'failed';

const TONE: Record<UpdateStatus, 'neutral' | 'brand' | 'success' | 'danger'> = { requested: 'neutral', running: 'brand', succeeded: 'success', failed: 'danger', superseded: 'neutral' };
const ICON: Record<UpdateStatus, typeof IconCheck> = { requested: IconClockHour4, running: IconLoader2, succeeded: IconCircleCheck, failed: IconAlertTriangle, superseded: IconReplace };
const IN_FILTER: Record<Filter, (status: UpdateStatus) => boolean> = { all: () => true, active: status => status === 'requested' || status === 'running', done: status => status === 'succeeded', failed: status => status === 'failed' };
const utc = (iso: string) => `${iso.replace('T', ' ').slice(0, 16)} UTC`;

function CopyButton({ value, copy }: { value: string; copy: RootUpdatesCopy }) {
  const [done, setDone] = useState(false);
  return <Button size="sm" leading={done ? <IconCheck size={15} /> : <IconCopy size={15} />} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* clipboard refused: the text stays selectable */ }
  }}><span aria-live="polite">{done ? copy.copied : copy.copy}</span></Button>;
}

function LogDialog({ item, title, copy, onClose }: { item: UpdateItem; title: string; copy: RootUpdatesCopy; onClose: () => void }) {
  const [log, setLog] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/root/updates/${encodeURIComponent(item.id)}`).then(response => response.ok ? response.json() : Promise.reject(new Error('failed')))
      .then((body: { log?: string }) => { if (live) setLog(body.log ?? ''); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [item.id]);
  return <Dialog open sheet title={copy.logTitle} description={title} onClose={onClose} closeLabel={copy.close} actions={log ? <CopyButton value={log} copy={copy} /> : undefined}>
    {failed ? <p role="alert" className="ui-error">{copy.logFailed}</p>
      : log === null ? <p role="status" className="upd-muted">{copy.logLoading}</p>
      : log ? <pre className="upd-log" tabIndex={0}>{log}</pre> : <p className="upd-muted">{copy.logEmpty}</p>}
  </Dialog>;
}

export function UpdatesWorkspace({ copy, items, running, automatic, connected, branch, repository, url, stalled, now: serverNow }: {
  copy: RootUpdatesCopy; items: UpdateItem[]; running: string | null; automatic: boolean; connected: boolean; branch: string; repository: string; url: string; stalled: boolean; now: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const values = { branch, repository, url };
  const [now, setNow] = useState(serverNow);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [logFor, setLogFor] = useState<UpdateItem | null>(null);
  const active = items.some(item => item.status === 'requested' || item.status === 'running');

  // Relative times tick on their own; while an update is waiting or installing the list follows the server.
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 10_000);
    return () => clearInterval(timer);
  }, [active, router]);

  const duration = (ms: number) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return updatesCopyText(copy.durSec, { n: String(seconds) });
    if (seconds < 3600) return updatesCopyText(copy.durMin, { n: String(Math.round(seconds / 60)) });
    if (seconds < 86_400) return updatesCopyText(copy.durHour, { n: String(Math.round(seconds / 3600)) });
    return updatesCopyText(copy.durDay, { n: String(Math.round(seconds / 86_400)) });
  };
  const ago = (iso: string) => { const ms = now - new Date(iso).getTime(); return ms < 45_000 ? copy.justNow : updatesCopyText(copy.ago, { duration: duration(ms) }); };
  const counts = useMemo(() => Object.fromEntries((Object.keys(IN_FILTER) as Filter[]).map(key => [key, items.filter(item => IN_FILTER[key](item.status)).length])) as Record<Filter, number>, [items]);
  const shown = items.filter(item => IN_FILTER[filter](item.status));

  // The deploy script records "abc1234 - message (2026-11-10 00:04:08Z)".
  const parsed = running?.match(/^(\w+) - (.*) \((\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)Z\)$/);
  const runningSince = parsed ? `${parsed[3]}T${parsed[4]}Z` : null;

  async function update() {
    if (busy) return;
    setBusy(true); setMessage(null);
    const response = await fetch('/api/root/updates', { method: 'POST' }).catch(() => null);
    setBusy(false); setConfirming(false);
    setMessage(response?.ok ? { text: copy.requested, error: false } : { text: copy.failure, error: true });
    toast.notify({ tone: response?.ok ? 'success' : 'error', title: response?.ok ? copy.requested : copy.failure });
    if (response?.ok) router.refresh();
  }

  const rowTitle = (item: UpdateItem) => item.summary ?? updatesCopyText(copy.latest, { branch: item.branch });
  const rowDetail = (item: UpdateItem): ReactNode => {
    if (item.status === 'requested') return updatesCopyText(copy.waitingFor, { duration: duration(now - new Date(item.createdAt).getTime()) });
    if (item.status === 'running' && item.startedAt) return updatesCopyText(copy.runningFor, { duration: duration(now - new Date(item.startedAt).getTime()) });
    if (item.startedAt && item.finishedAt) return updatesCopyText(copy.took, { duration: duration(new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime()) });
    return null;
  };

  return <div className="upd">
    {stalled && <section className="upd-alert" role="status" aria-label={copy.stalledTitle}>
      <span className="upd-icon upd-icon--danger" aria-hidden="true"><IconTerminal2 size={18} /></span>
      <div className="upd-alert__body">
        <h2>{copy.stalledTitle}</h2>
        <p>{copy.stalled}</p>
        <div className="upd-code"><code>{updatesCopyText(copy.stalledCommand, values)}</code><CopyButton value={updatesCopyText(copy.stalledCommand, values)} copy={copy} /></div>
      </div>
    </section>}

    <section className="upd-hero" aria-label={copy.running}>
      <div className="upd-hero__main">
        <div className="upd-hero__text">
          <p className="upd-eyebrow"><span className="upd-pulse" aria-hidden="true" />{copy.running}</p>
          <h2 className="upd-hero__title">{parsed ? parsed[2] : running ?? copy.runningUnknown}</h2>
          {parsed && <p className="upd-meta"><code className="upd-sha">{parsed[1]!.slice(0, 7)}</code>{runningSince && <span title={utc(runningSince)}>{updatesCopyText(copy.installedAgo, { when: ago(runningSince) })}</span>}</p>}
        </div>
        <div className="upd-hero__action">
          <Button variant="primary" busy={busy} leading={<IconCloudDownload size={17} />} onClick={() => setConfirming(true)}>{copy.updateNow}</Button>
          <p className={message?.error ? 'ui-error' : 'upd-muted'} role={message ? (message.error ? 'alert' : 'status') : undefined}>{message?.text ?? updatesCopyText(copy.updateNowHelp, values)}</p>
        </div>
      </div>
      <dl className="upd-facts">
        <div className="upd-fact">
          <dt>{copy.automatic} <Badge tone={automatic ? 'success' : 'neutral'}>{automatic ? copy.badgeOn : copy.badgeOff}</Badge></dt>
          <dd>{updatesCopyText(automatic ? copy.automaticOn : copy.automaticOff, values)}</dd>
        </div>
        <div className="upd-fact">
          <dt>{copy.webhookTitle} <Badge tone={connected ? 'success' : 'warning'}>{connected ? copy.badgeConnected : copy.badgeNotSetUp}</Badge></dt>
          <dd>{connected ? updatesCopyText(copy.webhookReady, values) : <Button size="sm" leading={<IconBrandGithub size={15} />} onClick={() => setConnecting(true)}>{copy.webhookSetup}</Button>}</dd>
        </div>
      </dl>
    </section>

    <section className="upd-history" aria-label={copy.history}>
      <header className="upd-history__head">
        <div className="upd-history__title"><h2>{copy.history}</h2>{active && <span className="upd-watch" role="status"><span className="upd-pulse upd-pulse--brand" aria-hidden="true" />{copy.refreshing}</span>}</div>
        {items.length > 0 && <div className="upd-history__filter"><SegmentedControl legend={copy.filterLabel} value={filter} onChange={value => setFilter(value as Filter)} options={[
          { value: 'all', label: `${copy.filterAll} ${counts.all}` }, { value: 'active', label: `${copy.filterActive} ${counts.active}` },
          { value: 'done', label: `${copy.filterDone} ${counts.done}` }, { value: 'failed', label: `${copy.filterFailed} ${counts.failed}` },
        ]} /></div>}
      </header>
      {shown.length === 0 ? <p className="upd-empty" role="status">{items.length ? copy.emptyFilter : copy.empty}</p> : <ol className="upd-list">
        {shown.map(item => {
          const Icon = ICON[item.status];
          const sha = (item.deployedCommit ?? item.commit)?.slice(0, 7);
          const detail = rowDetail(item);
          return <li key={item.id} className={`upd-row upd-row--${item.status}`}>
            <span className={`upd-icon upd-icon--${TONE[item.status]}`} aria-hidden="true"><Icon size={18} className={item.status === 'running' ? 'upd-spin' : undefined} /></span>
            <div className="upd-row__body">
              <p className="upd-row__title">{rowTitle(item)}</p>
              <p className="upd-meta">
                {sha && <code className="upd-sha">{sha}</code>}
                <span className="upd-meta__item">{item.source === 'github' ? <IconBrandGithub size={14} aria-hidden="true" /> : <IconHandClick size={14} aria-hidden="true" />}{item.source === 'github' ? copy.fromGithub : copy.fromRoot}</span>
                <span title={utc(item.createdAt)}>{ago(item.createdAt)}</span>
                {detail && <span className="upd-meta__detail">{detail}</span>}
              </p>
            </div>
            <div className="upd-row__side">
              <span className="upd-row__state"><Badge tone={TONE[item.status]}>{copy[`status_${item.status}`]}</Badge>{detail && <span className="upd-row__detail">{detail}</span>}</span>
              {item.hasLog && <Button size="sm" variant="quiet" leading={<IconFileText size={15} />} onClick={() => setLogFor(item)}>{copy.showLog}</Button>}
            </div>
          </li>;
        })}
      </ol>}
    </section>

    <Dialog open={confirming} sheet title={updatesCopyText(copy.confirmTitle, values)} onClose={() => setConfirming(false)} busy={busy} closeLabel={copy.close}
      actions={<><Button onClick={() => setConfirming(false)} disabled={busy}>{copy.cancel}</Button><Button variant="primary" busy={busy} leading={<IconCloudDownload size={17} />} onClick={update}>{copy.confirmAction}</Button></>}>
      <p className="upd-dialog-text">{copy.confirmBody}</p>
    </Dialog>

    <Dialog open={connecting} sheet title={copy.webhookSetupTitle} description={copy.webhookSetupIntro} onClose={() => setConnecting(false)} closeLabel={copy.close}>
      <ol className="upd-steps">
        <li>{copy.webhookStep1}</li>
        <li>{updatesCopyText(copy.webhookStep2, values)}</li>
        <li>{copy.webhookStep3}<div className="upd-code"><code>{url}</code><CopyButton value={url} copy={copy} /></div></li>
        <li>{copy.webhookStep4}</li>
      </ol>
    </Dialog>

    {logFor && <LogDialog item={logFor} title={rowTitle(logFor)} copy={copy} onClose={() => setLogFor(null)} />}
  </div>;
}
