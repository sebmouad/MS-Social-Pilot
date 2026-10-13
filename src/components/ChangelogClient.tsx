'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';

interface Entry {
  id: string;
  publishedOn: string;
  title: string;
  body: string;
}

/** Add and remove entries of the public changelog. */
export function ChangelogClient({ entries }: { entries: Entry[] }) {
  const t = useTranslations('root.changelog');
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    const response = await fetch('/api/root/changelog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error ?? t('failed'));
      return;
    }
    form.reset();
    router.refresh();
  }

  async function remove(entry: Entry) {
    const yes = await confirm({ title: t('deleteTitle'), body: t('deleteBody', { title: entry.title }), confirmLabel: t('delete'), danger: true });
    if (!yes) return;
    const response = await fetch(`/api/root/changelog/${entry.id}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) setError(t('failed'));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div>
            <label className="label" htmlFor="changelog-date">{t('date')}</label>
            <input id="changelog-date" name="publishedOn" type="date" className="input" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div>
            <label className="label" htmlFor="changelog-title">{t('entryTitle')}</label>
            <input id="changelog-title" name="title" className="input" required maxLength={200} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="changelog-body">{t('body')}</label>
          <textarea id="changelog-body" name="body" className="input min-h-24" maxLength={5000} />
        </div>
        {error && <p role="alert" className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" disabled={pending}>{t('add')}</button>
      </form>
      {entries.length === 0 ? (
        <p className="card p-5 text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">{entry.publishedOn}</p>
                <p className="font-medium text-slate-900">{entry.title}</p>
                {entry.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{entry.body}</p>}
              </div>
              <button type="button" className="btn-secondary" onClick={() => remove(entry)}>{t('delete')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
