'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';
import type { PostMedia } from '@/lib/json';
import {
  buildCaption,
  templatesFor,
  type CaptionFormat,
  type CaptionTemplate,
  type Money,
  type StructuredItem,
} from '@/lib/structured-data';

const AVAILABILITY = new Set(['InStock', 'OutOfStock', 'PreOrder', 'LimitedAvailability', 'SoldOut', 'OnlineOnly', 'InStoreOnly', 'BackOrder', 'Discontinued']);
const UNITS = new Set(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']);

/**
 * The date as the page wrote it: an event at 19:00 in its own zone is said
 * as 19:00, whatever zone the author's browser is in.
 */
function wallClock(iso: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!match) return iso;
  const [, y, mo, d, h, mi] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)));
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', ...(h ? { timeStyle: 'short' } : {}), timeZone: 'UTC' }).format(date);
}

function amount(value: number, currency: string | null, locale: string): string {
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
    } catch {
      // An unknown code falls through to the plain number.
    }
  }
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return currency ? `${plain} ${currency}` : plain;
}

/**
 * "Use page details": read the linked page's schema.org data
 * and turn a product, event, recipe, job… into a ready post, pictures included.
 */
export function StructuredDataButton({
  url,
  hasText,
  mediaRoom,
  onText,
  onMedia,
}: {
  url: string;
  hasText: boolean;
  /** How many more pictures the post can take. */
  mediaRoom: number;
  onText: (text: string) => void;
  onMedia: (media: PostMedia[]) => void;
}) {
  const t = useTranslations('structured');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StructuredItem[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [template, setTemplate] = useState<CaptionTemplate>('facts');
  const [withPictures, setWithPictures] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const format: CaptionFormat = useMemo(
    () => ({
      label: (key) => t(`fact_${key}`),
      date: (iso) => wallClock(iso, locale),
      money: (money: Money) => {
        const range = money.max !== null ? `${amount(money.min, money.currency, locale)} – ${amount(money.max, money.currency, locale)}` : amount(money.min, money.currency, locale);
        return money.unit && UNITS.has(money.unit) ? `${range} ${t(`per_${money.unit}`)}` : range;
      },
      availability: (code) => (AVAILABILITY.has(code) ? t(`availability_${code}`) : code.replace(/([a-z])([A-Z])/g, '$1 $2')),
      minutes: (minutes) => {
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        if (!hours) return t('timeMinutes', { minutes: rest });
        return rest ? `${t('timeHours', { hours })} ${String(rest).padStart(2, '0')}` : t('timeHours', { hours });
      },
      rating: (rating, count) => {
        const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rating);
        return count ? t('ratingWithCount', { rating: value, count }) : t('rating', { rating: value });
      },
      countdown: (days) => t('countdown', { days }),
      ingredients: t('ingredients'),
      steps: t('steps'),
    }),
    [t, locale],
  );

  async function openDialog() {
    setOpen(true);
    setItems(null);
    setProblem(null);
    setChosen(0);
    setTemplate('facts');
    const response = await fetch('/api/structured-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { items?: StructuredItem[]; error?: string } | undefined;
    if (!response?.ok) setProblem(body?.error ?? t('failed'));
    setItems(body?.items ?? []);
  }

  const item = items?.[chosen] ?? null;
  const templates = item ? templatesFor(item, now) : [];
  const activeTemplate = templates.includes(template) ? template : 'facts';
  // The link is the post's card already, so the caption does not repeat it.
  const caption = item ? buildCaption(item, activeTemplate, format, now, null) : '';
  const pictures = item ? item.images.slice(0, Math.max(0, mediaRoom)) : [];

  async function use() {
    if (!item) return;
    if (hasText && !(await confirm({ title: t('replaceConfirm'), body: t('replaceConfirmBody'), confirmLabel: t('replace') }))) return;
    setBusy(true);
    setProblem(null);
    onText(caption);
    if (withPictures && pictures.length) {
      const response = await fetch('/api/media/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: pictures }),
      }).catch(() => null);
      const body = (await response?.json().catch(() => ({}))) as { media?: PostMedia[]; problems?: string[]; error?: string } | undefined;
      if (body?.media?.length) onMedia(body.media);
      const problems = body?.problems ?? [];
      if (!response?.ok || problems.length) {
        setBusy(false);
        setProblem(
          problems.length
            ? t('picturesFailed', { count: problems.length, list: problems.join(' · ') })
            : body?.error ?? t('failed'),
        );
        return;
      }
    }
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="btn-secondary shrink-0" disabled={!url.trim()} onClick={openDialog}>
        {t('button')}
      </button>
      <Dialog
        open={open}
        title={t('title')}
        onClose={() => setOpen(false)}
        closeLabel={tCommon('close')}
        wide
        footer={
          item ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={use}>
                {busy ? t('importing') : t('use')}
              </button>
            </>
          ) : undefined
        }
      >
        {items === null ? (
          <p className="text-sm text-slate-600">{t('reading')}</p>
        ) : items.length === 0 ? (
          <div className="space-y-2 text-sm text-slate-600">
            {problem && <p className="text-red-700">{problem}</p>}
            <p>{t('none')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.length > 1 && (
              <fieldset>
                <legend className="label">{t('found')}</legend>
                <div className="space-y-1.5">
                  {items.map((entry, index) => (
                    <label key={`${entry.kind}-${entry.name}`} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <input type="radio" name="structured-item" checked={chosen === index} onChange={() => setChosen(index)} />
                      <span className="badge shrink-0">{t(`kind_${entry.kind}`)}</span>
                      <span className="truncate text-slate-800">{entry.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {items.length === 1 && item && (
              <p className="flex items-center gap-2 text-sm">
                <span className="badge shrink-0">{t(`kind_${item.kind}`)}</span>
                <span className="truncate font-medium text-slate-800">{item.name}</span>
              </p>
            )}
            <div className="segmented w-fit max-w-full flex-wrap" role="radiogroup" aria-label={t('template')}>
              {templates.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={activeTemplate === value}
                  className={`segmented-item ${activeTemplate === value ? 'segmented-item-active' : ''}`}
                  onClick={() => setTemplate(value)}
                >
                  {t(`template_${value}`)}
                </button>
              ))}
            </div>
            <div>
              <p className="label">{t('preview')}</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800">{caption}</pre>
            </div>
            {item && item.images.length > 0 && (
              <div className="space-y-2">
                {pictures.length > 0 ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={withPictures} onChange={(event) => setWithPictures(event.target.checked)} />
                    {t('pictures', { count: pictures.length })}
                  </label>
                ) : (
                  <p className="hint">{t('noRoom')}</p>
                )}
                <div className="flex gap-2 overflow-x-auto">
                  {item.images.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-slate-200" />
                  ))}
                </div>
              </div>
            )}
            {problem && <p className="text-sm text-red-700">{problem}</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}
