'use client';

import { useTranslations } from 'next-intl';

export interface CaptionTestChoice {
  on: boolean;
  /** Captions B, C, D; caption A is the message itself. */
  captions: string[];
  hours: 24 | 48 | 72 | 168;
}

export const NO_CAPTION_TEST: CaptionTestChoice = { on: false, captions: [''], hours: 48 };

const HOURS = [24, 48, 72, 168] as const;
const LABELS = ['B', 'C', 'D'];

/**
 * Caption A/B test (NEXT_PHASES G9), in the composer: the same content with up
 * to three more captions. Says how the Pages will be shared out, so nobody is
 * surprised by posts on later days.
 */
export function CaptionTestFields({
  value,
  onChange,
  pages,
}: {
  value: CaptionTestChoice;
  onChange: (value: CaptionTestChoice) => void;
  pages: number;
}) {
  const t = useTranslations('captionTests.composer');
  const total = value.captions.length + 1;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3">
      <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
          checked={value.on}
          onChange={(event) => onChange({ ...value, on: event.target.checked })}
        />
        <span>
          {t('toggle')}
          <span className="block text-xs font-normal text-slate-600">{t('toggleHint')}</span>
        </span>
      </label>

      {value.on && (
        <div className="mt-3 space-y-3">
          {value.captions.map((caption, index) => (
            <div key={LABELS[index]}>
              <div className="flex items-center justify-between">
                <label className="label" htmlFor={`caption-${LABELS[index]}`}>
                  {t('caption', { label: LABELS[index]! })}
                </label>
                {index > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-600 hover:underline"
                    onClick={() => onChange({ ...value, captions: value.captions.filter((_, position) => position !== index) })}
                  >
                    {t('remove')}
                  </button>
                )}
              </div>
              <textarea
                id={`caption-${LABELS[index]}`}
                className="input min-h-[88px]"
                value={caption}
                onChange={(event) =>
                  onChange({
                    ...value,
                    captions: value.captions.map((item, position) => (position === index ? event.target.value : item)),
                  })
                }
              />
            </div>
          ))}
          {value.captions.length < 3 && (
            <button
              type="button"
              className="btn-ghost h-10 rounded-full px-3 text-sm"
              onClick={() => onChange({ ...value, captions: [...value.captions, ''] })}
            >
              {t('add')}
            </button>
          )}
          <div>
            <label className="label" htmlFor="caption-test-hours">
              {t('compareAfter')}
            </label>
            <select
              id="caption-test-hours"
              className="input"
              value={value.hours}
              onChange={(event) => onChange({ ...value, hours: Number(event.target.value) as CaptionTestChoice['hours'] })}
            >
              {HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {t('hours', { hours })}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-600">
            {pages >= total ? t('planSplit', { pages, captions: total }) : t('planDays', { captions: total })}
          </p>
        </div>
      )}
    </div>
  );
}
