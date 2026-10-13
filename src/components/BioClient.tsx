'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

interface BioState {
  slug: string;
  title: string;
  description: string;
  avatarUrl: string;
  enabled: boolean;
  links: Array<{ label: string; url: string; clicks?: number }>;
}

/** Edit the link-in-bio page: its address, its words, and its links in order. */
export function BioClient({ initial }: { initial: BioState }) {
  const t = useTranslations('bio');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setLink = (index: number, patch: Partial<BioState['links'][number]>) =>
    setState((current) => ({ ...current, links: current.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) }));
  const move = (index: number, by: number) =>
    setState((current) => {
      const links = [...current.links];
      const target = index + by;
      if (target < 0 || target >= links.length) return current;
      [links[index], links[target]] = [links[target]!, links[index]!];
      return { ...current, links };
    });

  async function save() {
    setPending(true);
    setMessage(null);
    const response = await fetch('/api/bio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: state.slug,
        title: state.title,
        description: state.description || null,
        avatarUrl: state.avatarUrl || null,
        enabled: state.enabled,
        links: state.links.map(({ label, url }) => ({ label, url })),
      }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setMessage({ ok: false, text: body?.error ?? tCommon('genericError') });
      return;
    }
    setMessage({ ok: true, text: t('saved') });
    router.refresh();
  }

  const address = state.slug ? `${typeof window === 'undefined' ? '' : window.location.origin}/bio/${state.slug}` : '';

  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="bio-slug">{t('slug')}</label>
          <input id="bio-slug" className="input max-w-sm" value={state.slug} onChange={(event) => setState({ ...state, slug: event.target.value })} placeholder="my-brand" />
          {address && <p className="hint">{t('addressHint', { address })}</p>}
        </div>
        <div>
          <label className="label" htmlFor="bio-title">{t('pageTitle')}</label>
          <input id="bio-title" className="input max-w-sm" value={state.title} maxLength={80} onChange={(event) => setState({ ...state, title: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="bio-desc">{t('description')}</label>
          <textarea id="bio-desc" className="input max-w-lg" rows={2} maxLength={300} value={state.description} onChange={(event) => setState({ ...state, description: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="bio-avatar">{t('avatar')}</label>
          <input id="bio-avatar" className="input max-w-lg" value={state.avatarUrl} onChange={(event) => setState({ ...state, avatarUrl: event.target.value })} placeholder="https://" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={state.enabled} onChange={(event) => setState({ ...state, enabled: event.target.checked })} />
          {t('enabled')}
        </label>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">{t('links')}</h2>
        {state.links.length === 0 && <p className="text-sm text-slate-600">{t('noLinks')}</p>}
        <ul className="space-y-2">
          {state.links.map((link, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <input className="input min-w-0 flex-1 basis-40" value={link.label} maxLength={80} placeholder={t('linkLabel')} aria-label={t('linkLabel')} onChange={(event) => setLink(index, { label: event.target.value })} />
              <input className="input min-w-0 flex-1 basis-56" value={link.url} placeholder="https://" aria-label={t('linkUrl')} onChange={(event) => setLink(index, { url: event.target.value })} />
              {link.clicks !== undefined && <span className="nums text-xs text-slate-500">{t('clicks', { count: link.clicks })}</span>}
              <button type="button" className="btn-secondary h-9 px-2" aria-label={t('moveUp')} onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
              <button type="button" className="btn-secondary h-9 px-2" aria-label={t('moveDown')} onClick={() => move(index, 1)} disabled={index === state.links.length - 1}>↓</button>
              <button type="button" className="btn-secondary h-9 px-2" aria-label={t('remove')} onClick={() => setState({ ...state, links: state.links.filter((_, i) => i !== index) })}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary" onClick={() => setState({ ...state, links: [...state.links, { label: '', url: '' }] })}>
          <Icon name="plus" size={14} /> {t('addLink')}
        </button>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending || !state.slug || !state.title} onClick={() => void save()}>
          {pending ? tCommon('working') : t('save')}
        </button>
        {message && <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</p>}
      </div>
    </div>
  );
}
