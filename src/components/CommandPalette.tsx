'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { Icon } from './Icon';

/**
 * Ctrl/⌘-K: jump to any screen by typing a few letters. The list is whatever
 * the sidebar already offers this person, so it never leads somewhere they
 * could not go.
 */
export function CommandPalette({ items }: { items: Array<{ href: string; label: string }> }) {
  const t = useTranslations('palette');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 lg:flex"
        onClick={() => setOpen(true)}
        aria-label={t('open')}
      >
        <Icon name="search" size={15} />
        {t('hint')}
        <kbd className="rounded bg-white px-1.5 text-xs text-slate-500">Ctrl K</kbd>
      </button>
      <Dialog open={open} title={t('title')} onClose={close} closeLabel={tCommon('close')}>
        <input
          ref={input}
          className="input"
          autoFocus
          value={query}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter' && results[active]) {
              go(results[active]!.href);
            }
          }}
        />
        <ul className="mt-3 max-h-72 space-y-0.5 overflow-y-auto" role="listbox" aria-label={t('title')}>
          {results.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">{t('none')}</li>}
          {results.map((item, index) => (
            <li key={item.href} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={`w-full rounded-md px-3 py-2 text-start text-sm font-medium ${index === active ? 'bg-brand-50 text-brand-600' : 'text-slate-800 hover:bg-slate-100'}`}
                onClick={() => go(item.href)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
