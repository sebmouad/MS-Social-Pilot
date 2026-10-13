'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';
import { changedFields, wordDiff, type PostVersionView } from '@/lib/post-version-diff';

/**
 * Version history in Compose: every save of the post, what it
 * changed, its text compared with what is in the composer now, and a way to
 * load it back. Loading only fills the form; saving it is an ordinary save.
 */
export function VersionHistory({
  postId,
  currentMessage,
  pageName,
  labelName,
  onRestore,
}: {
  postId: string;
  currentMessage: string;
  pageName: (id: string) => string | null;
  labelName: (id: string) => string | null;
  onRestore: (version: PostVersionView) => void;
}) {
  const t = useTranslations('versions');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<PostVersionView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);

  async function openDialog() {
    setOpen(true);
    setChosen(null);
    setVersions(null);
    setFailed(false);
    const response = await fetch(`/api/posts/${postId}/versions`).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { versions?: PostVersionView[] } | undefined;
    setFailed(!response?.ok);
    setVersions(body?.versions ?? []);
  }

  async function restore(version: PostVersionView) {
    if (!(await confirm({ title: t('restoreConfirm'), body: t('restoreConfirmBody'), confirmLabel: t('restore') }))) return;
    onRestore(version);
    setOpen(false);
  }

  const when = (version: PostVersionView) =>
    format.dateTime(new Date(version.createdAt), { dateStyle: 'medium', timeStyle: 'short' });
  const names = (ids: string[], lookup: (id: string) => string | null) =>
    ids.map((id) => lookup(id) ?? t('removed')).join(', ') || t('nothing');

  const version = versions && chosen !== null ? versions[chosen] : null;

  return (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={openDialog}>
        {t('open')}
      </button>
      <Dialog
        open={open}
        title={version ? t('versionOf', { when: when(version) }) : t('title')}
        onClose={() => setOpen(false)}
        closeLabel={tCommon('close')}
        wide
        footer={
          version ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setChosen(null)}>
                {t('back')}
              </button>
              <button type="button" className="btn-primary" onClick={() => restore(version)}>
                {t('restore')}
              </button>
            </>
          ) : undefined
        }
      >
        {versions === null ? (
          <p className="text-sm text-slate-600">{t('loading')}</p>
        ) : version ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="label">{t('textComparedWithNow')}</p>
              <p className="hint">{t('diffLegend')}</p>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">
                {wordDiff(version.message, currentMessage).map((part, index) =>
                  part.kind === 'same' ? (
                    <span key={index}>{part.text}</span>
                  ) : part.kind === 'removed' ? (
                    <del key={index} className="rounded bg-red-100 text-red-800">
                      {part.text}
                    </del>
                  ) : (
                    <ins key={index} className="rounded bg-emerald-100 text-emerald-800 no-underline">
                      {part.text}
                    </ins>
                  ),
                )}
              </div>
            </div>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="font-medium text-slate-600">{t('pages')}</dt>
              <dd>{names(version.targetIds, pageName)}</dd>
              <dt className="font-medium text-slate-600">{t('time')}</dt>
              <dd>{version.scheduledAtLocal ? version.scheduledAtLocal.replace('T', ' ') : t('noTime')}</dd>
              <dt className="font-medium text-slate-600">{t('media')}</dt>
              <dd>{version.media.length > 0 ? t('mediaCount', { count: version.media.length }) : t('nothing')}</dd>
              <dt className="font-medium text-slate-600">{t('labels')}</dt>
              <dd>{names(version.labelIds, labelName)}</dd>
              {version.link && (
                <>
                  <dt className="font-medium text-slate-600">{t('link')}</dt>
                  <dd className="break-all">{version.link}</dd>
                </>
              )}
              {version.firstComment && (
                <>
                  <dt className="font-medium text-slate-600">{t('firstComment')}</dt>
                  <dd className="whitespace-pre-wrap">{version.firstComment}</dd>
                </>
              )}
            </dl>
          </div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-slate-600">{failed ? t('loadFailed') : t('none')}</p>
        ) : (
          <ol className="space-y-1.5">
            {versions.map((entry, index) => {
              const older = versions[index + 1];
              const fields = older ? changedFields(older, entry) : [];
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-start hover:border-brand-300 hover:bg-brand-50"
                    onClick={() => setChosen(index)}
                  >
                    <span className="block text-sm font-semibold text-slate-900">
                      {when(entry)}
                      {index === 0 && <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t('latest')}</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {entry.authorName ?? t('formerMember')}
                      {' · '}
                      {older
                        ? fields.length > 0
                          ? t('changed', { fields: fields.map((field) => t(`field.${field}`)).join(', ') })
                          : t('unchanged')
                        : t('firstSave')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Dialog>
    </>
  );
}
