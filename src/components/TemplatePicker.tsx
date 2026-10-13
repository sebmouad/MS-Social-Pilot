'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';
import { placeholdersOf, templateText } from '@/lib/post-templates';

export interface PostTemplateOption {
  id: string;
  name: string;
  category: string;
  body: string;
  hashtags: string;
  firstComment: string;
  labelId: string | null;
}

/** Templates grouped by category, uncategorised last, in the order given. */
export function byCategory<T extends { category: string }>(templates: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const template of templates) groups.set(template.category, [...(groups.get(template.category) ?? []), template]);
  return [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
}

/**
 * Post templates in the composer: pick one, fill its
 * placeholders, and it writes the text, hashtags, first comment and label.
 */
export function TemplatePicker({
  hasText,
  onUse,
}: {
  hasText: boolean;
  onUse: (template: { text: string; firstComment: string; labelId: string | null }) => void;
}) {
  const t = useTranslations('templates');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<PostTemplateOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PostTemplateOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function openDialog() {
    setOpen(true);
    setChosen(null);
    setValues({});
    setFailed(false);
    const response = await fetch('/api/post-templates').catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { templates?: PostTemplateOption[] } | undefined;
    setFailed(!response?.ok);
    setTemplates(body?.templates ?? []);
  }

  async function use() {
    if (!chosen) return;
    if (hasText && !(await confirm({ title: t('replaceConfirm'), body: t('replaceConfirmBody'), confirmLabel: t('replace') }))) return;
    onUse({ text: templateText(chosen, values), firstComment: chosen.firstComment, labelId: chosen.labelId });
    setOpen(false);
  }

  const fields = chosen ? placeholdersOf(chosen.body) : [];

  return (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={openDialog}>
        {t('pick')}
      </button>
      <Dialog
        open={open}
        title={chosen ? chosen.name : t('pickTitle')}
        onClose={() => setOpen(false)}
        closeLabel={tCommon('close')}
        wide
        footer={
          chosen ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setChosen(null)}>
                {t('back')}
              </button>
              <button type="button" className="btn-primary" onClick={use}>
                {t('use')}
              </button>
            </>
          ) : undefined
        }
      >
        {templates === null ? (
          <p className="text-sm text-slate-600">{t('loading')}</p>
        ) : chosen ? (
          <div className="space-y-4">
            {fields.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => (
                  <div key={field}>
                    <label className="label" htmlFor={`template-field-${field}`}>
                      {field}
                    </label>
                    <input
                      id={`template-field-${field}`}
                      className="input"
                      value={values[field] ?? ''}
                      onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <p className="label">{t('preview')}</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800">
                {templateText(chosen, values)}
              </pre>
              {chosen.firstComment && <p className="hint">{t('withFirstComment', { comment: chosen.firstComment })}</p>}
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className="space-y-2 text-sm text-slate-600">
            <p>{failed ? t('loadFailed') : t('none')}</p>
            <Link href="/templates" className="font-medium text-brand-600 hover:underline">
              {t('manage')}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {byCategory(templates).map(([category, entries]) => (
              <section key={category || '-'} aria-label={category || t('noCategory')}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{category || t('noCategory')}</h3>
                <ul className="space-y-1.5">
                  {entries.map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-start hover:border-brand-300 hover:bg-brand-50"
                        onClick={() => {
                          setChosen(template);
                          setValues({});
                        }}
                      >
                        <span className="block text-sm font-semibold text-slate-900">{template.name}</span>
                        <span className="block truncate text-xs text-slate-500">{template.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <Link href="/templates" className="inline-block text-sm font-medium text-brand-600 hover:underline">
              {t('manage')}
            </Link>
          </div>
        )}
      </Dialog>
    </>
  );
}
