'use client';
import { useInboxCatalog } from './copy-context';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, ShortcutHint, useShortcut } from '@/components';
import { IndeterminateCheckbox } from '@/components/IndeterminateCheckbox';
import { useToast } from '@/components/Toast';
import { BULK_INVERSE, bulkConfirmation, type BulkAction } from '@/modules/inbox/bulk';
import { runBulkInboxAction } from './bulk-action';
import { useInboxSelection, type SelectableItem } from './InboxSelection';
import type { InboxLocale } from './copy';
import styles from './inbox-round3.module.css';

/** Hide, show again and delete reach the platform, so they ask first. Resolve and reopen are local and reversible, so they run now and offer Undo. */
const ASKS_FIRST: readonly BulkAction[] = ['hide', 'unhide', 'delete'];

/**
 * Selection toolbar for the Inbox list: select the page, then resolve, hide or delete the chosen items.
 * Which actions appear is decided from what the signed-in person may do on each selected item; the shared bulk
 * service decides again on the server. Partly failed requests keep the failed items selected so none are lost.
 */
export function BulkBar({ locale, maxItems }: { locale: InboxLocale; maxItems: number }) {
  const copy = useInboxCatalog('round3Copy')[locale].bulk;
  const selection = useInboxSelection();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ action: BulkAction; items: SelectableItem[] } | null>(null);
  const chosen = [...selection.items.values()];
  const all = (test: (item: SelectableItem) => boolean) => chosen.length > 0 && chosen.every(test);
  const resolveAction: BulkAction | null = all(item => item.can.resolve) ? (all(item => !item.resolved) ? 'resolve' : all(item => item.resolved) ? 'reopen' : null) : null;
  const hideAction: BulkAction | null = all(item => item.kind === 'comment' && item.can.hide) ? (all(item => !item.hidden) ? 'hide' : all(item => item.hidden) ? 'unhide' : null) : null;
  const canDelete = all(item => item.kind === 'comment' && item.can.remove);
  const tooMany = chosen.length > maxItems;
  const platformNames = (items: SelectableItem[]) => [...new Set(items.map(item => item.platformName))].join(' / ');
  const pageCount = selection.pageItems.length;
  const allSelected = pageCount > 0 && selection.pageItems.every(item => selection.has(item.key));

  useShortcut('escape', () => selection.clear(), chosen.length > 0 && !asking);

  /** Runs one bulk request and reports truthfully. Returns an error message only when nothing was applied. */
  async function execute(action: BulkAction, items: SelectableItem[], inline: boolean): Promise<string | null> {
    setBusy(true);
    const outcome = await runBulkInboxAction({ action, items: items.map(({ kind, id }) => ({ kind, id })), confirmation: bulkConfirmation(action, items.length) }).catch(() => null);
    setBusy(false);
    if (!outcome) { if (!inline) toast.failed(copy.failedTitle, () => { void execute(action, items, false); }, copy.retry, copy.unconfirmed); return copy.unconfirmed; }
    if (!outcome.ok) { if (!inline) toast.failed(copy.failedTitle, () => { void execute(action, items, false); }, copy.retry, outcome.error); return outcome.error; }
    const done = outcome.results.filter(result => result.ok);
    const failedKeys = outcome.results.filter(result => !result.ok).map(result => `${result.kind}:${result.id}`);
    if (!done.length) { const first = outcome.results.find(result => !result.ok); const message = first && !first.ok ? first.error : copy.unconfirmed; if (!inline) toast.failed(copy.failedTitle, () => { void execute(action, items, false); }, copy.retry, message); return message; }
    selection.replace(failedKeys);
    router.refresh();
    const inverse = BULK_INVERSE[action];
    const doneItems = items.filter(item => done.some(result => result.kind === item.kind && result.id === item.id));
    if (failedKeys.length) toast.notify({ tone: 'error', title: copy.partial(done.length, failedKeys.length), duration: 0 });
    else if (inverse) toast.undoable(copy.done[action](done.length), () => { void undo(inverse, doneItems); }, copy.undo);
    else toast.notify({ title: copy.done[action](done.length) });
    return null;
  }

  async function undo(action: BulkAction, items: SelectableItem[]) {
    setBusy(true);
    const outcome = await runBulkInboxAction({ action, items: items.map(({ kind, id }) => ({ kind, id })), confirmation: bulkConfirmation(action, items.length) }).catch(() => null);
    setBusy(false);
    router.refresh();
    if (outcome?.ok && !outcome.failed) toast.notify({ title: copy.undone });
    else toast.notify({ tone: 'error', title: copy.undoPartial, duration: 0 });
  }

  function start(action: BulkAction) {
    if (ASKS_FIRST.includes(action)) setAsking({ action, items: chosen });
    else void execute(action, chosen, false);
  }

  const confirmCopy = copy.confirm;
  const askText = asking && (asking.action === 'hide' ? { title: confirmCopy.hideTitle, sentence: confirmCopy.hideSentence, label: confirmCopy.hideConfirm, danger: false }
    : asking.action === 'unhide' ? { title: confirmCopy.unhideTitle, sentence: confirmCopy.unhideSentence, label: confirmCopy.unhideConfirm, danger: false }
    : { title: confirmCopy.deleteTitle, sentence: confirmCopy.deleteSentence, label: confirmCopy.deleteConfirm, danger: true });
  const reason = tooMany ? copy.limit(maxItems) : undefined;

  return <div className={styles.bulk} role="region" aria-label={copy.region} data-active={chosen.length > 0 || undefined}>
    <label className={styles.selectAll}>
      <IndeterminateCheckbox checked={allSelected} indeterminate={chosen.length > 0 && !allSelected} onChange={() => { if (allSelected) selection.clear(); else selection.selectPage(); }} aria-label={copy.selectAll} />
      <span>{chosen.length ? copy.count(chosen.length) : copy.selectAll}</span>
    </label>
    {chosen.length > 0 ? <div className={styles.bulkActions}>
      {resolveAction ? <Button size="sm" variant="secondary" disabled={busy || tooMany} title={reason} onClick={() => start(resolveAction)}>{copy[resolveAction]}</Button> : null}
      {hideAction ? <Button size="sm" variant="secondary" disabled={busy || tooMany} title={reason} onClick={() => start(hideAction)}>{copy[hideAction]}</Button> : null}
      {canDelete ? <Button size="sm" variant="danger" disabled={busy || tooMany} title={reason} onClick={() => start('delete')}>{copy.delete}</Button> : null}
      {!resolveAction && !hideAction && !canDelete ? <span className={styles.bulkNote}>{copy.mixed}</span> : null}
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => selection.clear()} trailing={<ShortcutHint chord="escape" />}>{copy.clear}</Button>
      {tooMany ? <span className={styles.bulkNote} role="status">{copy.limit(maxItems)}</span> : null}
    </div> : null}
    {askText && asking ? <ConfirmDialog open title={askText.title} objectName={confirmCopy.object(asking.items.length)} consequence={askText.sentence(asking.items.length, platformNames(asking.items))}
      confirmLabel={askText.label} cancelLabel={confirmCopy.cancel} pendingLabel={confirmCopy.pending} failureLabel={confirmCopy.failure} danger={askText.danger}
      onConfirm={() => execute(asking.action, asking.items, true)} onClose={() => setAsking(null)} /> : null}
  </div>;
}
