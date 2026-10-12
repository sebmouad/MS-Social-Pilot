'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { EmptyState } from './EmptyState';
import { forgetSavedReplies } from './SavedReplies';

interface Reply {
  id: string;
  name: string;
  body: string;
}

export function SavedRepliesClient({ replies }: { replies: Reply[] }) {
  const t = useTranslations('savedReplies');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const router = useRouter();

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error || tCommon('genericError'));
        return false;
      }
      forgetSavedReplies();
      router.refresh();
      return true;
    } catch {
      setError(tCommon('genericError'));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(id: string | 'new', fields: { name: string; body: string }) {
    const done = id === 'new' ? await call('/api/saved-replies', 'POST', fields) : await call(`/api/saved-replies/${id}`, 'PATCH', fields);
    if (done) setEditing(null);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {editing === null && (
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          {t('add')}
        </button>
      )}
      {editing === 'new' && (
        <ReplyForm initial={{ name: '', body: '' }} pending={pending} onCancel={() => setEditing(null)} onSave={(fields) => save('new', fields)} />
      )}

      {replies.length === 0 && editing !== 'new' ? (
        <EmptyState icon="comment" title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <ul className="space-y-3">
          {replies.map((reply) =>
            editing === reply.id ? (
              <li key={reply.id}>
                <ReplyForm initial={reply} pending={pending} onCancel={() => setEditing(null)} onSave={(fields) => save(reply.id, fields)} />
              </li>
            ) : (
              <li key={reply.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{reply.name}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{reply.body}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={pending || editing !== null} onClick={() => setEditing(reply.id)}>
                    {tCommon('edit')}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-700"
                    disabled={pending}
                    onClick={async () => {
                      if (await confirm({ title: t('deleteConfirm', { name: reply.name }), danger: true, confirmLabel: tCommon('delete') })) {
                        void call(`/api/saved-replies/${reply.id}`, 'DELETE');
                      }
                    }}
                  >
                    {tCommon('delete')}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function ReplyForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: { name: string; body: string };
  pending: boolean;
  onCancel: () => void;
  onSave: (fields: { name: string; body: string }) => void;
}) {
  const t = useTranslations('savedReplies');
  const tCommon = useTranslations('common');
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);

  return (
    <form
      className="card space-y-4 p-4"
      aria-label={t('formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ name, body });
      }}
    >
      <div>
        <label className="label" htmlFor={`${id}-name`}>
          {t('name')}
        </label>
        <input id={`${id}-name`} className="input" required maxLength={80} value={name} placeholder={t('namePlaceholder')} onChange={(event) => setName(event.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-body`}>
          {t('body')}
        </label>
        <textarea id={`${id}-body`} className="input" rows={4} required maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} />
        <p className="mt-1 text-xs text-slate-500">{t('bodyHint')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {t('save')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
