'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';
import { EmptyState } from './EmptyState';
import { LabelChips } from './LabelChips';
import { byCategory, type PostTemplateOption } from './TemplatePicker';
import { placeholdersOf, TEMPLATE_LIMITS } from '@/lib/post-templates';

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

const BLANK = { name: '', category: '', body: '', hashtags: '', firstComment: '', labelId: null as string | null };

/** Post templates (NEXT_PHASES H4): list by category; editors add, change and remove. */
export function TemplatesClient({
  templates,
  labels,
  canEdit,
}: {
  templates: PostTemplateOption[];
  labels: LabelOption[];
  canEdit: boolean;
}) {
  const t = useTranslations('templates');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const confirm = useConfirm();
  const labelOf = new Map(labels.map((label) => [label.id, label]));
  const categories = [...new Set(templates.map((template) => template.category).filter(Boolean))];

  const [editing, setEditing] = useState<{ id: string | null; form: typeof BLANK } | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function start(template?: PostTemplateOption) {
    setProblem(null);
    setEditing(
      template
        ? { id: template.id, form: { name: template.name, category: template.category, body: template.body, hashtags: template.hashtags, firstComment: template.firstComment, labelId: template.labelId } }
        : { id: null, form: BLANK },
    );
  }

  function set<K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) {
    setEditing((current) => (current ? { ...current, form: { ...current.form, [key]: value } } : current));
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setProblem(null);
    const response = await fetch(editing.id ? `/api/post-templates/${editing.id}` : '/api/post-templates', {
      method: editing.id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editing.form),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setSaving(false);
    if (!response?.ok) {
      setProblem(body?.error ?? t('saveFailed'));
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(template: PostTemplateOption) {
    if (!(await confirm({ title: t('removeConfirm', { name: template.name }), body: t('removeConfirmBody'), confirmLabel: t('remove'), danger: true }))) return;
    const response = await fetch(`/api/post-templates/${template.id}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) router.refresh();
  }

  const fields = editing ? placeholdersOf(editing.form.body) : [];

  return (
    <div className="space-y-6">
      {canEdit && (
        <div>
          <button type="button" className="btn-primary" onClick={() => start()}>
            {t('add')}
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState icon="compose" title={t('emptyTitle')} hint={canEdit ? t('emptyBodyEditor') : t('emptyBody')} />
      ) : (
        byCategory(templates).map(([category, entries]) => (
          <section key={category || '-'} className="card p-4 sm:p-5" aria-label={category || t('noCategory')}>
            <h2 className="mb-3 text-base font-semibold text-slate-900">{category || t('noCategory')}</h2>
            <ul className="divide-y divide-slate-100">
              {entries.map((template) => {
                const label = template.labelId ? labelOf.get(template.labelId) : undefined;
                return (
                  <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                        {template.name}
                        {label && <LabelChips labels={[label]} />}
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{template.body}</p>
                      {template.hashtags && <p className="mt-1 text-sm text-brand-700">{template.hashtags}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" className="btn-ghost text-sm" onClick={() => start(template)} aria-label={t('editNamed', { name: template.name })}>
                          {t('edit')}
                        </button>
                        <button type="button" className="btn-ghost text-sm text-red-700" onClick={() => remove(template)} aria-label={t('removeNamed', { name: template.name })}>
                          {t('remove')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <Dialog
        open={editing !== null}
        title={editing?.id ? t('editTitle') : t('addTitle')}
        onClose={() => setEditing(null)}
        closeLabel={tCommon('close')}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={saving || !editing?.form.name.trim() || !editing?.form.body.trim()} onClick={save}>
              {saving ? t('saving') : t('save')}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="template-name">
                  {t('name')}
                </label>
                <input id="template-name" className="input" maxLength={TEMPLATE_LIMITS.name} value={editing.form.name} onChange={(event) => set('name', event.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="template-category">
                  {t('category')}
                </label>
                <input
                  id="template-category"
                  className="input"
                  list="template-categories"
                  maxLength={TEMPLATE_LIMITS.category}
                  placeholder={t('categoryPlaceholder')}
                  value={editing.form.category}
                  onChange={(event) => set('category', event.target.value)}
                />
                <datalist id="template-categories">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="template-body">
                {t('body')}
              </label>
              <textarea
                id="template-body"
                className="input min-h-[140px] resize-y"
                maxLength={TEMPLATE_LIMITS.body}
                placeholder={t('bodyPlaceholder')}
                aria-describedby="template-body-hint"
                value={editing.form.body}
                onChange={(event) => set('body', event.target.value)}
              />
              <p id="template-body-hint" className="hint">
                {fields.length ? t('fieldsFound', { count: fields.length, fields: fields.join(', ') }) : t('bodyHint')}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="template-hashtags">
                {t('hashtags')}
              </label>
              <input
                id="template-hashtags"
                className="input"
                maxLength={TEMPLATE_LIMITS.hashtags}
                placeholder={t('hashtagsPlaceholder')}
                value={editing.form.hashtags}
                onChange={(event) => set('hashtags', event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="template-comment">
                {t('firstComment')}
              </label>
              <textarea
                id="template-comment"
                className="input min-h-[64px] resize-y"
                maxLength={TEMPLATE_LIMITS.firstComment}
                value={editing.form.firstComment}
                onChange={(event) => set('firstComment', event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="template-label">
                {t('label')}
              </label>
              <select id="template-label" className="input" value={editing.form.labelId ?? ''} onChange={(event) => set('labelId', event.target.value || null)}>
                <option value="">{t('noLabel')}</option>
                {labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </div>
            {problem && (
              <p role="alert" className="text-sm text-red-700">
                {problem}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
