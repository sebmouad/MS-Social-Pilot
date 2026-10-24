'use client';
import { useInboxCatalog } from './copy-context';

import { useCallback, useEffect, useState } from 'react';
import { IconMessageCircleSearch, IconPencil, IconTrash } from '@tabler/icons-react';
import { Button, ConfirmDialog, Drawer, EmptyState, Field, Menu, Skeleton, TextInput } from '@/components';
import { useToast } from '@/components/Toast';
import { isOperationErrorCode } from '@/lib/operation-error';
import type { InboxLocale } from './copy';
import styles from './inbox-round3.module.css';

type Reply = { id: string; name: string; body: string };
type Loaded = { replies: Reply[]; total: number; maxCount: number; limits: { nameMax: number; bodyMax: number } };
type Draft = { id: string | null; name: string; body: string };
const EMPTY: Draft = { id: null, name: '', body: '' };

async function call(init?: { method: 'POST'; body: unknown }, query = 'view=saved-replies'): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/inbox/productivity?${query}`, init ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : { cache: 'no-store' });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(body && typeof body.error === 'string' && isOperationErrorCode(body.code) ? body.error : '');
  return body;
}

/**
 * Create, edit and delete the workspace's saved replies in a side panel that keeps the list visible.
 * Same service as the per-conversation shortcut and the MCP tools: the Root-set count and length limits are enforced
 * on the server and shown here as usage, so a full library explains itself instead of failing silently.
 */
export function SavedRepliesManager({ locale, canWrite }: { locale: InboxLocale; canWrite: boolean }) {
  const copy = useInboxCatalog('round3Copy')[locale].replies;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Reply | null>(null);

  const load = useCallback(async (search: string) => {
    setLoadError('');
    try {
      const body = await call(undefined, `view=saved-replies${search ? `&q=${encodeURIComponent(search)}` : ''}`);
      const limits = body.limits as { nameMaxCharacters?: number; bodyMaxCharacters?: number } | undefined;
      setLoaded({ replies: (body.replies as Reply[]) ?? [], total: Number(body.total ?? 0), maxCount: Number(body.maxCount ?? 0), limits: { nameMax: limits?.nameMaxCharacters ?? 100, bodyMax: limits?.bodyMaxCharacters ?? 2000 } });
    } catch (error) { setLoadError(error instanceof Error && error.message ? error.message : copy.loadError); }
  }, [copy.loadError]);

  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(query.trim()), query ? 250 : 0); return () => clearTimeout(timer); }, [open, query, load]);

  async function act(body: Record<string, unknown>): Promise<string | null> {
    setBusy(true);
    try {
      const result = await call({ method: 'POST', body });
      if (result.ok !== true) return copy.unconfirmed;
      await load(query.trim());
      return null;
    } catch (error) { return error instanceof Error && error.message ? error.message : copy.unconfirmed; }
    finally { setBusy(false); }
  }

  async function save() {
    const name = draft.name.trim(), text = draft.body.trim();
    if (!name || !text) { setFormError(copy.required); return; }
    setFormError('');
    const failure = await act(draft.id
      ? { action: 'reply.update', id: draft.id, name, body: text, confirmation: `UPDATE SAVED REPLY ${draft.id}` }
      : { action: 'reply.create', name, body: text, confirmation: `CREATE SAVED REPLY ${name}` });
    if (failure) { setFormError(failure); return; }
    toast.notify({ title: draft.id ? copy.updated : copy.created });
    setDraft(EMPTY);
  }

  const full = Boolean(loaded && loaded.maxCount > 0 && loaded.total >= loaded.maxCount);
  const nameMax = loaded?.limits.nameMax ?? 100, bodyMax = loaded?.limits.bodyMax ?? 2000;
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>{copy.open}</Button>
    <Drawer open={open} title={copy.title} description={copy.description} closeLabel={copy.close} onClose={() => { if (!busy) { setOpen(false); setDraft(EMPTY); setFormError(''); } }} busy={busy}>
      <div className={styles.replyStack}>
        {loaded ? <p className={styles.replyUsage} role="status">{full ? copy.full(loaded.maxCount) : copy.usage(loaded.total, loaded.maxCount)}</p> : null}
        <Field label={copy.search}><TextInput type="search" value={query} placeholder={copy.searchPlaceholder} onChange={event => setQuery(event.target.value)} /></Field>
        {loadError ? <EmptyState tone="error" icon={<IconMessageCircleSearch size={24} />} title={copy.loadError} action={<Button onClick={() => void load(query.trim())}>{copy.retry}</Button>}>{loadError}</EmptyState>
          : !loaded ? <div role="status" aria-label={copy.loading}><Skeleton /></div>
          : loaded.replies.length ? <ul className={styles.replyList}>{loaded.replies.map(reply => <li key={reply.id} className={styles.replyCard}>
            <div className={styles.replyHead}><strong>{reply.name}</strong>
              {canWrite ? <Menu label={copy.actions(reply.name)} items={[
                { key: 'edit', label: copy.edit, icon: <IconPencil size={16} />, disabled: busy, onSelect: () => { setDraft({ id: reply.id, name: reply.name, body: reply.body }); setFormError(''); } },
                { key: 'delete', label: copy.delete, icon: <IconTrash size={16} />, danger: true, disabled: busy, onSelect: () => setRemoving(reply) },
              ]} /> : null}
            </div>
            <p>{reply.body}</p>
          </li>)}</ul>
          : query.trim() ? <EmptyState icon={<IconMessageCircleSearch size={24} />} title={copy.noMatch} action={<Button onClick={() => setQuery('')}>{copy.clearSearch}</Button>}>{copy.noMatchBody}</EmptyState>
          : <EmptyState icon={<IconMessageCircleSearch size={24} />} title={copy.empty}>{copy.emptyBody}</EmptyState>}
        {canWrite ? (full && !draft.id ? null : <form className={styles.replyForm} onSubmit={event => { event.preventDefault(); void save(); }} noValidate>
          <h3>{draft.id ? copy.editing(draft.name) : copy.newReply}</h3>
          <Field label={copy.name} error={formError && !draft.name.trim() ? formError : undefined}>
            <TextInput value={draft.name} maxLength={nameMax} placeholder={copy.namePlaceholder} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <label className="ui-field"><span>{copy.text}</span>
            <textarea value={draft.body} maxLength={bodyMax} placeholder={copy.textPlaceholder} disabled={busy} onChange={event => setDraft({ ...draft, body: event.target.value })} />
            <span className={styles.counter}>{copy.counter(draft.body.length, bodyMax)}</span>
          </label>
          {formError && draft.name.trim() ? <p role="alert" className={styles.error}>{formError}</p> : null}
          <div className={styles.formActions}>
            <Button type="submit" variant="primary" busy={busy}>{draft.id ? copy.save : copy.create}</Button>
            {draft.id ? <Button variant="quiet" disabled={busy} onClick={() => { setDraft(EMPTY); setFormError(''); }}>{copy.cancelEdit}</Button> : null}
          </div>
        </form>) : <p className={styles.replyUsage}>{copy.readOnly}</p>}
      </div>
    </Drawer>
    {removing ? <ConfirmDialog open title={copy.deleteTitle} objectName={removing.name} consequence={copy.deleteConsequence} confirmLabel={copy.deleteConfirm} cancelLabel={copy.cancel} pendingLabel={copy.pending} failureLabel={copy.deleteFailure}
      onConfirm={async () => { const failure = await act({ action: 'reply.delete', id: removing.id, confirmation: `DELETE SAVED REPLY ${removing.id}` }); if (!failure) toast.notify({ title: copy.deleted }); return failure; }} onClose={() => setRemoving(null)} /> : null}
  </>;
}
