'use client';

import { useTranslations } from 'next-intl';

import { WATERMARK_DEFAULTS, WATERMARK_POSITIONS, type Watermark, type WatermarkPosition } from '@/lib/image-format';

export interface WatermarkDraft {
  mode: 'none' | 'text' | 'logo';
  text: string;
  mediaId: string;
  position: WatermarkPosition;
  opacity: number;
  size: number;
}

export function draftOf(watermark: Watermark | null): WatermarkDraft {
  return {
    mode: watermark?.mediaId ? 'logo' : watermark?.text ? 'text' : 'none',
    text: watermark?.text ?? '',
    mediaId: watermark?.mediaId ?? '',
    position: watermark?.position ?? WATERMARK_DEFAULTS.position,
    opacity: watermark?.opacity ?? WATERMARK_DEFAULTS.opacity,
    size: watermark?.size ?? WATERMARK_DEFAULTS.size,
  };
}

/** What the API stores: null for none. */
export function watermarkOf(draft: WatermarkDraft): Watermark | null {
  const base = { position: draft.position, opacity: draft.opacity, size: draft.size };
  if (draft.mode === 'logo' && draft.mediaId) return { mediaId: draft.mediaId, ...base };
  if (draft.mode === 'text' && draft.text.trim()) return { text: draft.text.trim(), ...base };
  return null;
}

const PLACE: Record<WatermarkPosition, string> = {
  'top-start': 'top-[3%] start-[3%]',
  'top-end': 'top-[3%] end-[3%]',
  center: 'top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2',
  'bottom-start': 'bottom-[3%] start-[3%]',
  'bottom-end': 'bottom-[3%] end-[3%]',
};

/**
 * A Page's watermark: a library image or a line of text,
 * where it sits, how strong and how big — with a preview of where it lands.
 */
export function WatermarkFields({
  idPrefix,
  value,
  onChange,
  logos,
}: {
  idPrefix: string;
  value: WatermarkDraft;
  onChange: (value: WatermarkDraft) => void;
  /** Images from the media library that can serve as the logo. */
  logos: Array<{ id: string; filename: string; url: string }>;
}) {
  const t = useTranslations('watermark');
  const set = (patch: Partial<WatermarkDraft>) => onChange({ ...value, ...patch });
  const logo = logos.find((item) => item.id === value.mediaId);
  const showing = (value.mode === 'logo' && logo) || (value.mode === 'text' && value.text.trim());

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
      <div className="space-y-3">
        <div className="segmented" role="radiogroup" aria-label={t('kind')}>
          {(['none', 'text', 'logo'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value.mode === mode}
              className={`segmented-item ${value.mode === mode ? 'segmented-item-active' : ''}`}
              onClick={() => set({ mode })}
            >
              {t(`mode.${mode}`)}
            </button>
          ))}
        </div>

        {value.mode === 'text' && (
          <label className="block text-sm">
            <span className="label">{t('text')}</span>
            <input className="input" maxLength={80} value={value.text} placeholder={t('textPlaceholder')} onChange={(event) => set({ text: event.target.value })} />
          </label>
        )}

        {value.mode === 'logo' &&
          (logos.length === 0 ? (
            <p className="hint">{t('noLogos')}</p>
          ) : (
            <label className="block text-sm">
              <span className="label">{t('logo')}</span>
              <select className="input" value={value.mediaId} onChange={(event) => set({ mediaId: event.target.value })}>
                <option value="">{t('pickLogo')}</option>
                {logos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.filename}
                  </option>
                ))}
              </select>
              <span className="hint">{t('logoHint')}</span>
            </label>
          ))}

        {value.mode !== 'none' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="label">{t('position')}</span>
              <select className="input" value={value.position} onChange={(event) => set({ position: event.target.value as WatermarkPosition })}>
                {WATERMARK_POSITIONS.map((position) => (
                  <option key={position} value={position}>
                    {t(`positions.${position}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm" htmlFor={`${idPrefix}-opacity`}>
              <span className="label">{t('opacity', { value: value.opacity })}</span>
              <input id={`${idPrefix}-opacity`} type="range" className="w-full" min={10} max={100} step={5} value={value.opacity} onChange={(event) => set({ opacity: Number(event.target.value) })} />
            </label>
            <label className="text-sm" htmlFor={`${idPrefix}-size`}>
              <span className="label">{t('size', { value: value.size })}</span>
              <input id={`${idPrefix}-size`} type="range" className="w-full" min={5} max={40} step={1} value={value.size} onChange={(event) => set({ size: Number(event.target.value) })} />
            </label>
          </div>
        )}
        <p className="hint">{t('hint')}</p>
      </div>

      <figure aria-label={t('preview')} className="relative aspect-[4/5] w-40 overflow-hidden rounded-lg bg-gradient-to-br from-slate-300 to-slate-500">
        {showing && (
          <span className={`absolute ${PLACE[value.position]}`} style={{ opacity: value.opacity / 100, width: `${value.size}%` }}>
            {value.mode === 'logo' && logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.url} alt="" className="block w-full" />
            ) : (
              <span className="block whitespace-nowrap text-[10px] font-bold text-white [text-shadow:0_0_2px_rgba(0,0,0,.4)]">{value.text}</span>
            )}
          </span>
        )}
      </figure>
    </div>
  );
}
