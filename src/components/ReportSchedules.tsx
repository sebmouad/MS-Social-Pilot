'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';

import { Dialog } from './Dialog';
import { Icon } from './Icon';

export interface ScheduleRow {
  id: string;
  frequency: 'weekly' | 'monthly';
  recipients: string[];
  nextLabel: string;
  lastLabel: string | null;
  lastError: string | null;
  aiRecap: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Email this report": the Page's report goes to the client every Monday or
 * every 1st, with no one having to remember. The dialog lists what is
 * already set up for this Page, so a second schedule is a choice, not an
 * accident.
 */
export function ReportSchedules({
  targetId,
  pageName,
  schedules,
  templateId,
  aiOn,
}: {
  targetId: string;
  pageName: string;
  schedules: ScheduleRow[];
  templateId: string | null;
  /** AI is set up and on for this workspace: offer the summary. */
  aiOn: boolean;
}) {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [recipients, setRecipients] = useState('');
  const [aiRecap, setAiRecap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const list = recipients
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = list.filter((value) => !EMAIL.test(value));

  async function create() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/report-schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, frequency, recipients: list, templateId, aiRecap: aiOn && aiRecap }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> } | undefined;
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setRecipients('');
    router.refresh();
  }

  async function remove(row: ScheduleRow) {
    if (!(await confirm({ title: t('scheduleDeleteConfirm'), danger: true, confirmLabel: t('scheduleDelete') }))) return;
    await fetch(`/api/report-schedules/${row.id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn-secondary print:hidden" onClick={() => setOpen(true)}>
        <Icon name="mail" size={16} />
        {t('scheduleButton')}
        {schedules.length > 0 && (
          <span className="nums rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">{schedules.length}</span>
        )}
      </button>

      <Dialog
        open={open}
        title={t('scheduleTitle', { page: pageName })}
        onClose={close}
        closeLabel={tCommon('close')}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('close')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || list.length === 0 || invalid.length > 0}
              onClick={() => void create()}
            >
              {pending ? tCommon('working') : t('scheduleCreate')}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {schedules.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {schedules.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Icon name="calendar" size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">
                      {t(`frequency_${row.frequency}`)} · {row.recipients.join(', ')}
                      {row.aiRecap && (
                        <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                          {t('scheduleAiRecapBadge')}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t('scheduleNext', { when: row.nextLabel })}
                      {row.lastLabel && ` · ${t('scheduleLast', { when: row.lastLabel })}`}
                    </span>
                    {row.lastError && <span className="block text-xs text-red-600">{row.lastError}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-xs hover:text-red-600"
                    onClick={() => void remove(row)}
                    aria-label={t('scheduleDelete')}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t('scheduleHint')}</p>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="segmented w-fit" role="radiogroup" aria-label={t('frequency')}>
              {(['weekly', 'monthly'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={frequency === value}
                  className={`segmented-item ${frequency === value ? 'segmented-item-active' : ''}`}
                  onClick={() => setFrequency(value)}
                >
                  {t(`frequency_${value}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">{t(`frequencyHint_${frequency}`)}</p>
            <div>
              <label className="label" htmlFor="schedule-recipients">
                {t('recipients')}
              </label>
              <textarea
                id="schedule-recipients"
                className="input min-h-[64px]"
                placeholder="client@example.com, boss@example.com"
                value={recipients}
                onChange={(event) => setRecipients(event.target.value)}
              />
              <p className={`mt-1 text-xs ${invalid.length ? 'text-red-600' : 'text-slate-500'}`}>
                {invalid.length ? t('recipientsInvalid', { list: invalid.join(', ') }) : t('recipientsHint')}
              </p>
            </div>
            {aiOn && (
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  checked={aiRecap}
                  onChange={(event) => setAiRecap(event.target.checked)}
                />
                <span>
                  {t('scheduleAiRecap')}
                  <span className="block text-xs text-slate-500">{t('scheduleAiRecapHint')}</span>
                </span>
              </label>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
