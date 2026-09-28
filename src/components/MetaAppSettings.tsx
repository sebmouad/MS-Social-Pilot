'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import type { MetaAppSettings as Settings } from '@/lib/meta-app';

/**
 * Every value the Meta app needs, with where it goes and a copy button.
 *
 * Built from this installation's own address, so what is pasted is exactly
 * what the app will send and what Meta will call back.
 */
export function MetaAppSettings({ settings, open = false }: { settings: Settings; open?: boolean }) {
  const t = useTranslations('metaApp');
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // No clipboard (an insecure origin, an old browser): the value is on
      // screen and selectable, which is what matters.
    }
  }

  return (
    <details className="card group p-5" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-slate-900">{t('title')}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{t('subtitle')}</span>
        </span>
        <Icon name="settings" size={16} className="shrink-0 text-slate-400" />
      </summary>

      {settings.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {settings.warnings.map((warning) => (
            <li
              key={warning}
              className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
              {t(`warnings.${warning}`)}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 divide-y divide-slate-100">
        {settings.fields.map((field) => (
          <div key={field.key} className="py-3">
            <dt className="text-xs font-medium text-slate-700">{t(`fields.${field.key}.label`)}</dt>
            <dd className="mt-1 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-900">
                {field.value || '—'}
              </code>
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => copy(field.key, field.value)}
                aria-label={t('copyNamed', { name: t(`fields.${field.key}.label`) })}
              >
                {copied === field.key ? t('copied') : t('copy')}
              </button>
            </dd>
            <p className="hint">{t(`fields.${field.key}.where`)}</p>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-xs text-slate-500">{t('privacyNote')}</p>
    </details>
  );
}
