'use client';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';


import { useRef, useState } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { IconPin } from '@tabler/icons-react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

export type PinView = { key: string; label: string; sourceLabel: string; state: 'available' | 'unavailable'; value: string; coverage: string; asOf: string; basis: string; change: string };
export type Pinnable = { key: string; label: string; sourceLabel: string; pinned: boolean };

export function PinManager({ pins: initial, pinnable, max, copy = workspaceCopyDefaults, locale = 'en' }: { copy?: WorkspaceCopy; locale?: 'en' | 'fr'; pins: PinView[]; pinnable: Pinnable[]; max: number }) {
  const t = workspaceText(copy, locale);
  const [pins, setPins] = useState(initial);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<PinView | null>(null);
  const toast = useToast();
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const say = (text: string, error = false) => {
    setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
    if (error) toast.failed(text, () => window.location.reload(), t('Refresh and check'));
    else toast.notify({ title: text, tone: 'success' });
  };
  const pinnedKeys = new Set(pins.map(p => p.key));
  const options = pinnable.filter(p => !pinnedKeys.has(p.key));

  async function send(body: Record<string, unknown>, apply: () => void, success: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/analytics/pins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.ok !== true) throw new Error(result && typeof result.error === 'string' ? result.error : t('Your pins could not be saved. Refresh and check before trying again.'));
      apply(); say(success);
    } catch (error) { say(error instanceof Error ? error.message : t('The result is unknown. Refresh before retrying.'), true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  // Pinning and reordering change only your own view and are reversible, so the exact confirmation is sent after your explicit click.
  const pin = () => { const item = options.find(o => o.key === choice); if (!item) return; void send({ action: 'pin', key: item.key, confirmation: `PIN ANALYTICS METRIC ${item.key}` }, () => { window.location.reload(); }, t('Metric pinned.')); };
  // Removing a pin asks first (Cancel has initial focus). A failure leaves the dialog open with its error in the page notice.
  const unpin = async (key: string) => { await send({ action: 'unpin', key, confirmation: `UNPIN ANALYTICS METRIC ${key}` }, () => { setPins(c => c.filter(p => p.key !== key)); setRemoving(null); }, t('Pin removed.')); };
  const move = (index: number, by: -1 | 1) => {
    const next = [...pins]; const target = index + by; if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void send({ action: 'reorder', keys: next.map(p => p.key), confirmation: `REORDER ANALYTICS PINS ${next.length}` }, () => setPins(next), t('Order saved.'));
  };
  return <div className={styles.root}>
    {notice && <RouteNotice error={notice.error} focusKey={`pins:${notice.key}`}>{notice.text}</RouteNotice>}
    <section className={styles.panel} aria-labelledby="pin-add"><h2 id="pin-add">{t("Add a pinned metric")}</h2>
      {pins.length >= max ? <p className={styles.note}>{t("You have pinned the most metrics allowed (")}{max}{t("). Remove one to add another.")}</p>
        : options.length ? <form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); pin(); }}><label>{t("Metric")}<select value={choice} onChange={e => setChoice(e.target.value)}><option value="">{t("Choose a metric")}</option>{options.map(o => <option key={o.key} value={o.key}>{o.label} · {o.sourceLabel}</option>)}</select></label>
          <div className={styles.actions}><Button type="submit" variant="primary" disabled={busy || !choice}>{busy ? t('Saving…') : t('Pin metric')}</Button></div></form>
          : <p className={styles.empty}>{t("No more single-value metrics are available for your channels yet.")}</p>}</section>
    <section className={styles.panel} aria-labelledby="pin-list"><h2 id="pin-list">{t("Your pinned metrics (")}{pins.length}{" "}{t("of")}{" "}{max})</h2>
      {pins.length ? <ul className={styles.list}>{pins.map((p, i) => <li key={p.key}><div><MetricCard module="analytics" icon={<IconPin />} label={p.label} value={p.value} unavailable={p.state === 'unavailable' ? t('Not available for your current channels.') : undefined} />
        <small>{p.state === 'available' ? <>{p.value} · {p.basis} · {p.coverage}{" "}{t("· as of")}{" "}{p.asOf}{p.change ? ` · ${p.change}` : ''}</> : t('Not available for your current channels, so its value is unknown. You can remove it.')}</small></div>
        <div className={styles.actions}><Button size="sm" disabled={busy || i === 0} aria-label={t('Move {0} up', p.label)} onClick={() => move(i, -1)}>{t("Up")}</Button><Button size="sm" disabled={busy || i === pins.length - 1} aria-label={t('Move {0} down', p.label)} onClick={() => move(i, 1)}>{t("Down")}</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoving(p)}>{t("Unpin")}</Button></div></li>)}</ul>
        : <p className={styles.empty}>{t("Nothing pinned yet. Pinned metrics are personal and only visible to you.")}</p>}</section>
      <Dialog open={Boolean(removing)} title={t("Unpin metric")} description={removing ? t('{0} will no longer appear in your pinned metrics. This does not change any data, and you can pin it again.', removing.label) : undefined} busy={busy} onClose={() => !busy && setRemoving(null)}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setRemoving(null)}>{t("Cancel")}</Button><Button variant="danger" disabled={busy || !removing} onClick={() => removing && void unpin(removing.key)}>{busy ? t('Removing…') : t('Unpin')}</Button></>}><p>{removing?.sourceLabel}</p></Dialog>
  </div>;
}
