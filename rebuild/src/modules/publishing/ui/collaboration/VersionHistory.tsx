'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useConfirm } from '@/components/useConfirm';
import { restoreVersionConfirmation } from '../../collaboration/schemas';
import type { RestoreReview } from '../../server/version-restore-plan';
import { send, useAction } from './collab-client';
import { catalogGroup, composerCatalogDefaults, type ComposerCatalog } from '../../composer-catalog';
import styles from './collaboration.module.css';

type Version = { id: string; authorName: string | null; createdAt: string; createdLabel?: string; message: string };
type Receipt = { postId: string; versionId: string; approvalReset: boolean; restored: boolean; review: RestoreReview };
export function VersionHistory({ postId, versions, restore, canWrite, canRestoreNow, copyCatalog = composerCatalogDefaults }: { copyCatalog?: ComposerCatalog; postId: string; versions: Version[]; restore: boolean; canWrite: boolean; canRestoreNow: boolean; timeZone?: string }) {
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(/^fr\b/i.test(document.documentElement.lang || navigator.language) ? 'fr' : 'en'); }, []);
  const c = catalogGroup(copyCatalog, 'version', locale);
  const [target, setTarget] = useState<{ version: Version; review: RestoreReview } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const action = useAction();
  const [confirm, confirmationDialog] = useConfirm({ title: c.confirm, cancel: c.cancel, confirm: c.confirm, danger: false });
  async function preview(version: Version) {
    await action.run(async () => {
      const result = await action.send<Receipt>('POST', '/api/publishing/versions', { postId, versionId: version.id, mode: 'preview', confirmation: restoreVersionConfirmation(version.id) });
      if (result.postId !== postId || result.versionId !== version.id || result.restored !== false || !result.review) throw new Error(c.failed);
      setTarget({ version, review: result.review }); setReviewOpen(true);
      return '';
    });
  }
  async function apply() {
    if (!target || action.busy) return;
    setReviewOpen(false);
    const summary = [c.description, ...target.review.issues.map(i => i[locale])].join('\n');
    if (!await confirm(summary)) { setReviewOpen(true); return; }
    const ok = await action.run(async () => {
      const result = await action.send<Receipt>('POST', '/api/publishing/versions', { postId, versionId: target.version.id, mode: target.review.exact ? 'exact' : 'closest', reviewToken: target.review.token, confirmation: restoreVersionConfirmation(target.version.id) });
      if (result.postId !== postId || result.versionId !== target.version.id || result.restored !== true) throw new Error(c.failed);
      return result.approvalReset ? c.approval : c.success;
    });
    if (ok) setTarget(null); else setReviewOpen(true);
  }
  const controls = restore && canWrite && canRestoreNow;
  return <section className={styles.section} aria-labelledby="versions-title"><h2 id="versions-title">{c.title}</h2>
    {action.banner}
    {versions.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{c.title}</caption><thead><tr><th scope="col">{c.saved}</th><th scope="col">{c.by}</th><th scope="col">{c.text}</th>{controls && <th scope="col">{c.actions}</th>}</tr></thead>
      <tbody>{versions.map(v => <tr key={v.id}><th scope="row">{v.createdLabel || c.unavailable}</th><td>{v.authorName ?? c.unavailable}</td><td><span className={styles.msg}>{v.message || c.noText}</span></td>{controls && <td><Button size="sm" disabled={action.busy} onClick={() => void preview(v)}>{action.busy ? c.checking : c.restore}</Button></td>}</tr>)}</tbody></table></div> : <p className={styles.empty}>{c.empty}</p>}
    <Dialog open={reviewOpen && Boolean(target)} title={c.review} description={c.description} closeLabel={c.cancel} busy={action.busy} onClose={() => { setReviewOpen(false); setTarget(null); }} actions={<><Button disabled={action.busy} onClick={() => { setReviewOpen(false); setTarget(null); }}>{c.cancel}</Button><Button disabled={action.busy} onClick={() => target && void preview(target.version)}>{c.refresh}</Button><Button disabled={action.busy || !target?.review.canRestore} onClick={() => void apply()}>{target?.review.exact ? c.apply : c.closest}</Button></>}>
      {target && <>
        {target.review.issues.length > 0 && <><h3>{c.changes}</h3><ul>{target.review.issues.map((issue, i) => <li key={i}>{issue.destinationId ? `${issue.destinationName ?? issue.destinationId}: ` : ''}{issue[locale]}</li>)}</ul></>}
        {!target.review.canRestore && <p role="alert">{c.blocked}</p>}
        <p className={styles.note}>{target.review.content.message || c.noText}</p>
        <h3>{c.destinations}</h3><ul>{target.review.content.targetIds.map(id => <li key={id}>{target.review.destinations?.find(d => d.id === id)?.name ?? c.unavailable}: {target.review.destinations?.find(d => d.id === id)?.formatLabel ?? target.review.content.destinationFormats[id] ?? c.unavailable}</li>)}</ul>
        <p>{c.media}: {target.review.content.media.length}</p><ul>{target.review.content.media.map((item, i) => <li key={i}>{item.url}{item.altText ? ` — ${item.altText}` : ''}</li>)}</ul><p>{target.review.content.link}</p>
        <p>{c.comment}: {target.review.content.firstComment || c.noText}</p><p>{c.delay}: {target.review.content.firstCommentDelayMinutes}</p>
      </>}
      {action.feedback}
    </Dialog>{confirmationDialog}
  </section>;
}
