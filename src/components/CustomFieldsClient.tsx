'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { EmptyState } from './EmptyState';
import { useConfirm } from './ConfirmProvider';

interface FieldRow {
  id: string;
  name: string;
  kind: 'text' | 'choice';
  options: string[];
}

/** The fields a workspace adds to its posts: a name, and for a choice its options. */
export function CustomFieldsClient({ fields }: { fields: FieldRow[] }) {
  const t = useTranslations('customFields');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'text' | 'choice'>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body?: unknown) {
    setError(null);
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(data?.error ?? tCommon('genericError'));
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    const list = options.split(',').map((option) => option.trim()).filter(Boolean);
    if (await call('/api/custom-fields', 'POST', { name, kind, options: kind === 'choice' ? list : [] })) {
      setName('');
      setOptions('');
    }
  }

  async function remove(field: FieldRow) {
    if (!(await confirm({ title: t('deleteTitle', { name: field.name }), body: t('deleteBody'), confirmLabel: t('delete'), danger: true }))) return;
    await call(`/api/custom-fields/${field.id}`, 'DELETE');
  }

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-end gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void add();
        }}
      >
        <div className="min-w-0 flex-1 basis-48">
          <label className="label" htmlFor="field-name">{t('name')}</label>
          <input id="field-name" className="input" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t('namePlaceholder')} />
        </div>
        <div>
          <label className="label" htmlFor="field-kind">{t('kind')}</label>
          <select id="field-kind" className="input" value={kind} onChange={(event) => setKind(event.target.value as 'text' | 'choice')}>
            <option value="text">{t('kind_text')}</option>
            <option value="choice">{t('kind_choice')}</option>
          </select>
        </div>
        {kind === 'choice' && (
          <div className="min-w-0 flex-1 basis-56">
            <label className="label" htmlFor="field-options">{t('options')}</label>
            <input id="field-options" className="input" value={options} onChange={(event) => setOptions(event.target.value)} placeholder={t('optionsPlaceholder')} />
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={!name.trim()}>{t('add')}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {fields.length === 0 ? (
        <EmptyState icon="tag" title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {fields.map((field) => (
            <li key={field.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{field.name}</span>
                <span className="block text-xs text-slate-500">{field.kind === 'choice' ? field.options.join(', ') : t('kind_text')}</span>
              </span>
              <button type="button" className="btn-secondary" onClick={() => void remove(field)}>{t('delete')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
