'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';

type Action = 'shuffle' | 'clear' | 'clearDrafts';

/**
 * The ⋮ beside a Page wherever it is listed: the things done to one Page
 * without hunting for the screen they live on.
 */
export function PageMenu({ page, canManageQueue, canSettings }: { page: { id: string; name: string }; canManageQueue: boolean; canSettings: boolean }) {
  const t = useTranslations('pagesSidebar');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function run(action: Action) {
    setPending(true);
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, targetId: page.id }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { moved?: number } | undefined;
    setPending(false);
    setConfirm(null);
    setDone(response?.ok ? t(`done_${action}`, { count: body?.moved ?? 0 }) : tCommon('genericError'));
    router.refresh();
    window.setTimeout(() => setDone(null), 4000);
  }

  const links: Array<{ href: string; icon: IconName; label: string }> = [
    { href: `/compose?to=${page.id}`, icon: 'plus', label: t('menuNewPost') },
    { href: `/calendar?view=feed&pages=${page.id}`, icon: 'calendar', label: t('menuFeed') },
    { href: `/analytics?view=analysis&target=${page.id}`, icon: 'analytics', label: t('menuAnalysis') },
    ...(canSettings ? [{ href: '/settings/pages', icon: 'settings' as IconName, label: t('menuVoice') }] : []),
  ];
  const actions: Array<{ action: Action; icon: IconName; danger?: boolean }> = canManageQueue
    ? [
        { action: 'shuffle', icon: 'refresh' },
        { action: 'clear', icon: 'clock' },
        { action: 'clearDrafts', icon: 'trash', danger: true },
      ]
    : [];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 opacity-0 hover:bg-slate-200 focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
        aria-label={t('menuFor', { page: page.name })}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden className="text-lg leading-none">⋮</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {links.map((item) => (
            <Link key={item.href} role="menuitem" href={item.href} className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50" onClick={() => setOpen(false)}>
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
          {actions.length > 0 && <div className="my-1 border-t border-slate-100" />}
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 ${item.danger ? 'text-red-600' : 'text-slate-800'}`}
              onClick={() => {
                setOpen(false);
                setConfirm(item.action);
              }}
            >
              <Icon name={item.icon} size={16} />
              {t(`menu_${item.action}`)}
            </button>
          ))}
        </div>
      )}
      {done && (
        <p role="status" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
          {done}
        </p>
      )}
      <Dialog
        open={confirm !== null}
        title={confirm ? t(`confirmTitle_${confirm}`, { page: page.name }) : ''}
        onClose={() => setConfirm(null)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              className={`btn-primary ${confirm === 'clearDrafts' ? 'bg-red-600 hover:bg-red-700' : ''}`}
              disabled={pending}
              onClick={() => confirm && void run(confirm)}
            >
              {pending ? tCommon('working') : confirm ? t(`menu_${confirm}`) : ''}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{confirm ? t(`confirmHint_${confirm}`) : ''}</p>
      </Dialog>
    </div>
  );
}
