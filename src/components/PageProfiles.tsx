'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';

interface Profile {
  id: string;
  name: string;
  pictureUrl: string | null;
  category: string | null;
  brandVoice: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/**
 * Each Page's own voice and link tags. A bakery and a garage in one workspace
 * do not sound alike, and their links should not be counted as one campaign.
 */
export function PageProfiles({
  pages,
  workspaceUtm,
  canEdit,
}: {
  pages: Profile[];
  workspaceUtm: { source: string | null; medium: string | null; campaign: string | null };
  canEdit: boolean;
}) {
  const t = useTranslations('groups');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/targets/${editing.id}/profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandVoice: editing.brandVoice,
        utmSource: editing.utmSource,
        utmMedium: editing.utmMedium,
        utmCampaign: editing.utmCampaign,
      }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error ?? tCommon('genericError'));
      return;
    }
    setEditing(null);
    router.refresh();
  }

  const field = (key: 'utmSource' | 'utmMedium' | 'utmCampaign', label: string, fallback: string | null) => (
    <label className="text-sm">
      <span className="label">{label}</span>
      <input
        className="input"
        maxLength={key === 'utmCampaign' ? 200 : 100}
        placeholder={fallback ? t('inherits', { value: fallback }) : t('notSet')}
        value={editing?.[key] ?? ''}
        onChange={(event) => editing && setEditing({ ...editing, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <section className="card">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-[15px] font-semibold text-slate-900">{t('profilesTitle')}</h2>
        <p className="text-xs text-slate-500">{t('profilesHint')}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {pages.map((page) => {
          const tags = [page.utmSource, page.utmMedium, page.utmCampaign].filter(Boolean).length;
          return (
            <li key={page.id} className="flex items-center gap-3 px-4 py-2.5">
              <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{page.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {page.brandVoice ? page.brandVoice : t('voiceInherited')}
                  {tags > 0 && ` · ${t('ownTags', { count: tags })}`}
                </span>
              </span>
              {canEdit && (
                <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing({ ...page })}>
                  <Icon name="settings" size={14} />
                  {t('editProfile')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={editing !== null}
        title={editing ? t('profileTitle', { page: editing.name }) : ''}
        onClose={() => setEditing(null)}
        closeLabel={tCommon('close')}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => void save()}>
              {pending ? tCommon('working') : tCommon('save')}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-5">
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div>
              <label className="label" htmlFor="page-voice">
                {t('voiceField')}
              </label>
              <textarea
                id="page-voice"
                className="input min-h-[110px]"
                maxLength={2000}
                placeholder={t('voicePlaceholder')}
                value={editing.brandVoice ?? ''}
                onChange={(event) => setEditing({ ...editing, brandVoice: event.target.value })}
              />
              <p className="hint">{t('voiceHint')}</p>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-900">{t('utmTitle')}</legend>
              <p className="mb-2 text-xs text-slate-500">{t('utmHint')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {field('utmSource', 'utm_source', workspaceUtm.source)}
                {field('utmMedium', 'utm_medium', workspaceUtm.medium)}
                {field('utmCampaign', 'utm_campaign', workspaceUtm.campaign)}
              </div>
            </fieldset>
          </div>
        )}
      </Dialog>
    </section>
  );
}
