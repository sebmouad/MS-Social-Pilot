'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

interface View {
  id: string;
  name: string;
  query: string;
}

/** Only what narrows the list: where the user happens to be in time or in a list is not part of a view. */
const TRANSIENT = ['page', 'month', 'week'];

/**
 * Saved views: a named combination of channels, labels and filters on this
 * screen, reopened in one click. Lives in the channel column.
 */
export function SavedViews({ screen, views: initial }: { screen: 'calendar' | 'posts'; views: View[] }) {
  const t = useTranslations('savedViews');
  const pathname = usePathname();
  const params = useSearchParams();
  const [views, setViews] = useState(initial);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const current = new URLSearchParams(params.toString());
  for (const key of TRANSIENT) current.delete(key);
  const currentQuery = current.toString();
  const active = views.find((view) => view.query === currentQuery);

  async function save() {
    setError(null);
    try {
      const response = await fetch('/api/saved-views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, screen, query: currentQuery }),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { view: View };
      setViews((list) => [...list, body.view].sort((a, b) => a.name.localeCompare(b.name)));
      setNaming(false);
      setName('');
    } catch {
      setError(t('saveFailed'));
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/saved-views/${id}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) setViews((list) => list.filter((view) => view.id !== id));
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('title')}</p>
      {views.length === 0 && !naming && <p className="text-xs text-slate-500">{t('empty')}</p>}
      <ul className="space-y-1">
        {views.map((view) => (
          <li key={view.id} className="flex items-center gap-1">
            <Link
              href={`${pathname}${view.query ? `?${view.query}` : ''}`}
              aria-current={active?.id === view.id ? 'page' : undefined}
              className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm font-medium ${
                active?.id === view.id ? 'bg-brand-50 text-brand-600' : 'text-slate-800 hover:bg-slate-100'
              }`}
            >
              {view.name}
            </Link>
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
              aria-label={t('remove', { name: view.name })}
              onClick={() => void remove(view.id)}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {naming ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <input
            className="input h-9 min-w-0 flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('namePlaceholder')}
            aria-label={t('nameLabel')}
            maxLength={60}
            autoFocus
          />
          <button type="submit" className="btn-primary h-9 px-3" disabled={!name.trim()}>
            {t('save')}
          </button>
        </form>
      ) : (
        !active && (
          <button type="button" className="btn-secondary w-full" onClick={() => setNaming(true)}>
            <Icon name="plus" size={14} /> {t('saveCurrent')}
          </button>
        )
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
