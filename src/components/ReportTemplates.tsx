'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { Icon } from './Icon';

export interface TemplateRow {
  id: string;
  name: string;
  href: string;
  active: boolean;
}

/**
 * Saved report layouts as a row of chips: one click puts the sections and
 * the period back, the way the client is used to reading them.
 */
export function ReportTemplates({
  templates,
  sections,
  rangeKey,
  canSave,
}: {
  templates: TemplateRow[];
  /** What is on screen now, saved as is. */
  sections: string[];
  rangeKey: string;
  canSave: boolean;
}) {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function save() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/report-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), sections, rangeKey: rangeKey === 'custom' ? '30d' : rangeKey }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error ?? tCommon('genericError'));
      return;
    }
    setName('');
    setOpen(false);
    router.refresh();
  }

  async function remove(row: TemplateRow) {
    if (!window.confirm(t('templateDeleteConfirm', { name: row.name }))) return;
    await fetch(`/api/report-templates/${row.id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  if (templates.length === 0 && !canSave) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" aria-label={t('templates')} role="group">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('templates')}</span>
      {templates.map((row) => (
        <span
          key={row.id}
          className={`group inline-flex items-center rounded-full text-sm font-semibold ${
            row.active ? 'bg-brand-500 text-white' : 'bg-white text-slate-700 shadow-surface hover:bg-slate-50'
          }`}
        >
          <Link href={row.href} className="py-1.5 pl-3.5 pr-2" aria-current={row.active ? 'true' : undefined}>
            {row.name}
          </Link>
          {canSave && (
            <button
              type="button"
              className={`mr-1 flex h-6 w-6 items-center justify-center rounded-full ${
                row.active ? 'hover:bg-white/20' : 'text-slate-400 hover:bg-slate-100 hover:text-red-600'
              }`}
              aria-label={t('templateDelete', { name: row.name })}
              onClick={() => void remove(row)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      {templates.length === 0 && <span className="text-sm text-slate-500">{t('templatesNone')}</span>}
      {canSave && (
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={15} />
          {t('templateSave')}
        </button>
      )}

      <Dialog
        open={open}
        title={t('templateSaveTitle')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending || !name.trim()} onClick={() => void save()}>
              {pending ? tCommon('working') : t('templateSave')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('templateSaveHint')}</p>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <label className="label" htmlFor="template-name">
            {t('templateName')}
          </label>
          <input
            id="template-name"
            className="input"
            maxLength={60}
            placeholder={t('templateNamePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </Dialog>
    </div>
  );
}
