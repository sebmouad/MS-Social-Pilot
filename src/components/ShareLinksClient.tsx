'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';

interface LinkRow {
  id: string;
  kind: 'review' | 'calendar';
  title: string;
  pages: string[];
  createdLabel: string;
  revoked: boolean;
  answers: number;
}

interface Draft {
  kind: 'review' | 'calendar';
  title: string;
  description: string;
  targetIds: string[];
  daysBack: number;
  daysAhead: number;
  allowComments: boolean;
}

const EMPTY: Draft = { kind: 'review', title: '', description: '', targetIds: [], daysBack: 7, daysAhead: 30, allowComments: true };

export function ShareLinksClient({
  links,
  pages,
}: {
  links: LinkRow[];
  pages: Array<{ id: string; name: string; pictureUrl: string | null }>;
}) {
  const t = useTranslations('sharing');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => {
    setDraft(null);
    setMade(null);
    setError(null);
    setCopied(false);
  }, []);

  async function create() {
    if (!draft) return;
    setPending(true);
    setError(null);
    const response = await fetch('/api/share-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, description: draft.description || null }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string; fields?: Record<string, string> } | undefined;
    if (!response?.ok || !body?.url) {
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setMade(body.url);
    router.refresh();
  }

  async function revoke(link: LinkRow) {
    if (!window.confirm(t('revokeConfirm', { title: link.title }))) return;
    await fetch(`/api/share-links/${link.id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
          <Icon name="plus" size={16} />
          {t('newLink')}
        </button>
      </div>

      {links.length === 0 ? (
        <EmptyState icon="link" title={t('none')} hint={t('noneHint')} />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {links.map((link) => (
            <li key={link.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${link.revoked ? 'opacity-55' : ''}`}>
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  link.kind === 'review' ? 'bg-violet-50 text-violet-700' : 'bg-brand-50 text-brand-600'
                }`}
              >
                <Icon name={link.kind === 'review' ? 'approvals' : 'calendar'} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-slate-900">{link.title}</span>
                <span className="block truncate text-xs text-slate-500">
                  {t(`kind_${link.kind}`)} · {link.pages.length ? link.pages.join(', ') : t('allPages')} · {link.createdLabel}
                  {link.kind === 'review' && ` · ${t('answers', { count: link.answers })}`}
                </span>
              </span>
              {link.revoked ? (
                <span className="badge bg-slate-100 text-slate-600">{t('revoked')}</span>
              ) : (
                <button type="button" className="btn-secondary px-3 py-1 text-xs hover:text-red-600" onClick={() => void revoke(link)}>
                  {t('revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{t('oneTimeNote')}</p>

      <Dialog
        open={draft !== null}
        title={made ? t('madeTitle') : t('newLink')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          made ? (
            <button type="button" className="btn-primary" onClick={close}>
              {tCommon('close')}
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={close}>
                {tCommon('cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={pending || !draft?.title.trim()} onClick={() => void create()}>
                {pending ? tCommon('working') : t('create')}
              </button>
            </>
          )
        }
      >
        {made ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{t('madeHint')}</p>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={made} onFocus={(event) => event.target.select()} aria-label={t('linkLabel')} />
              <button type="button" className="btn-primary shrink-0" onClick={() => void copy()}>
                <Icon name={copied ? 'check' : 'link'} size={15} />
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          </div>
        ) : (
          draft && (
            <div className="space-y-4">
              {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('kindLabel')}>
                {(['review', 'calendar'] as const).map((kind) => (
                  <label
                    key={kind}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                      draft.kind === kind ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="share-kind"
                      className="mt-0.5 h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-500"
                      checked={draft.kind === kind}
                      onChange={() => setDraft({ ...draft, kind })}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{t(`kind_${kind}`)}</span>
                      <span className="block text-xs text-slate-600">{t(`kindHint_${kind}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div>
                <label className="label" htmlFor="share-title">{t('titleField')}</label>
                <input
                  id="share-title"
                  className="input"
                  maxLength={120}
                  placeholder={t('titlePlaceholder')}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="share-description">{t('descriptionField')}</label>
                <textarea
                  id="share-description"
                  className="input min-h-[60px]"
                  maxLength={500}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div>
                <p className="label">{t('pagesField')}</p>
                <p className="hint -mt-1 mb-2">{t('pagesHint')}</p>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                  {pages.map((page) => {
                    const on = draft.targetIds.includes(page.id);
                    return (
                      <li key={page.id}>
                        <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                            checked={on}
                            onChange={() =>
                              setDraft({
                                ...draft,
                                targetIds: on ? draft.targetIds.filter((id) => id !== page.id) : [...draft.targetIds, page.id],
                              })
                            }
                          />
                          <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                          <span className="truncate text-sm font-semibold text-slate-900">{page.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {draft.kind === 'calendar' ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="label">{t('daysBack')}</span>
                    <input type="number" min={0} max={90} className="input" value={draft.daysBack} onChange={(event) => setDraft({ ...draft, daysBack: Number(event.target.value) || 0 })} />
                  </label>
                  <label className="text-sm">
                    <span className="label">{t('daysAhead')}</span>
                    <input type="number" min={1} max={120} className="input" value={draft.daysAhead} onChange={(event) => setDraft({ ...draft, daysAhead: Number(event.target.value) || 1 })} />
                  </label>
                </div>
              ) : (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={draft.allowComments}
                    onChange={(event) => setDraft({ ...draft, allowComments: event.target.checked })}
                  />
                  {t('allowComments')}
                </label>
              )}
            </div>
          )
        )}
      </Dialog>
    </div>
  );
}
