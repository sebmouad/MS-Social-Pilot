'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Icon } from './Icon';
import type { Prediction } from '@/lib/engagement-prediction';
import type { PostFormat } from '@/lib/page-analysis';

const TONE: Record<Prediction['outlook'], string> = {
  above: 'bg-emerald-50 text-emerald-900',
  around: 'bg-slate-50 text-slate-700',
  below: 'bg-amber-50 text-amber-900',
  unknown: 'bg-slate-50 text-slate-600',
};

/**
 * Engagement prediction, in the composer: "likely above /
 * around / below this Page's usual", with the reasons. Never a number.
 */
export function EngagementOutlook({
  targetId,
  format,
  length,
  scheduledAtLocal,
  timezone,
}: {
  /** The first selected Page; null hides the card. */
  targetId: string | null;
  format: PostFormat;
  length: number;
  scheduledAtLocal: string | null;
  timezone: string;
}) {
  const t = useTranslations('outlook');
  const locale = useLocale();
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  useEffect(() => {
    if (!targetId || length === 0) {
      setPrediction(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch('/api/posts/outlook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId, format, length, scheduledAtLocal, timezone }),
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json().catch(() => ({}))) as { prediction?: Prediction | null };
      setPrediction(body.prediction ?? null);
    }, 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [targetId, format, length, scheduledAtLocal, timezone]);

  if (!prediction) return null;

  const valueLabel = (factor: string, value: string) =>
    factor === 'weekday'
      ? new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + Number(value))))
      : t(`value.${value}` as 'value.photo');

  return (
    <section aria-label={t('label')} className={`mt-3 rounded-lg p-3 text-xs ${TONE[prediction.outlook]}`}>
      <p className="flex items-start gap-2 font-semibold">
        <Icon name="trendUp" size={15} className="mt-px shrink-0" />
        {prediction.outlook === 'unknown' ? t('unknown', { count: prediction.basis }) : t(`outlook_${prediction.outlook}`)}
      </p>
      {prediction.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 ps-6">
          {prediction.reasons.map((reason) => (
            <li key={reason.factor}>
              {t('reason', {
                factor: t(`factor.${reason.factor}` as 'factor.format'),
                value: valueLabel(reason.factor, reason.value),
                percent: Math.round(reason.ratio * 100),
                posts: reason.posts,
              })}
            </li>
          ))}
        </ul>
      )}
      {prediction.outlook !== 'unknown' && <p className="mt-1.5 ps-6 opacity-80">{t('basis', { count: prediction.basis })}</p>}
    </section>
  );
}
