'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

const SIZES = {
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
  landscape: { w: 1200, h: 630 },
} as const;
type SizeKey = keyof typeof SIZES;

interface Layer {
  text: string;
  size: number;
  color: string;
  /** 0–100, from the left and the top. */
  x: number;
  y: number;
  bold: boolean;
}

/**
 * A small picture editor: pick a size, a colour or a photo for the
 * background, lay some text on it, and save the result to the media library,
 * ready for a post. Everything happens in the browser.
 */
export function DesignEditor() {
  const t = useTranslations('design');
  const tCommon = useTranslations('common');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<SizeKey>('square');
  const [background, setBackground] = useState('#1877f2');
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([{ text: '', size: 96, color: '#ffffff', x: 50, y: 50, bold: true }]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const draw = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const { w, h } = SIZES[size];
    element.width = w;
    element.height = h;
    context.fillStyle = background;
    context.fillRect(0, 0, w, h);
    if (photo) {
      // Cover the canvas, centred, without stretching.
      const scale = Math.max(w / photo.width, h / photo.height);
      const dw = photo.width * scale;
      const dh = photo.height * scale;
      context.drawImage(photo, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    for (const layer of layers) {
      if (!layer.text.trim()) continue;
      context.font = `${layer.bold ? '700' : '400'} ${layer.size}px system-ui, sans-serif`;
      context.fillStyle = layer.color;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      // Wrap on words to 80% of the width.
      const lines: string[] = [];
      let line = '';
      for (const word of layer.text.split(/\s+/)) {
        const attempt = line ? `${line} ${word}` : word;
        if (context.measureText(attempt).width > w * 0.8 && line) {
          lines.push(line);
          line = word;
        } else line = attempt;
      }
      lines.push(line);
      const lineHeight = layer.size * 1.2;
      lines.forEach((text, index) => context.fillText(text, (layer.x / 100) * w, (layer.y / 100) * h + (index - (lines.length - 1) / 2) * lineHeight));
    }
  }, [size, background, photo, layers]);

  useEffect(draw, [draw]);

  function loadPhoto(file: File | undefined) {
    if (!file) return;
    const image = new Image();
    image.onload = () => setPhoto(image);
    image.src = URL.createObjectURL(file);
  }

  const setLayer = (index: number, patch: Partial<Layer>) => setLayers((current) => current.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)));

  async function save() {
    const element = canvas.current;
    if (!element) return;
    setSaving(true);
    setStatus(null);
    const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
    if (!blob) {
      setSaving(false);
      return setStatus({ ok: false, text: tCommon('genericError') });
    }
    const form = new FormData();
    form.append('file', new File([blob], `design-${Date.now()}.png`, { type: 'image/png' }));
    const response = await fetch('/api/media', { method: 'POST', body: form }).catch(() => null);
    setSaving(false);
    setStatus(response?.ok ? { ok: true, text: t('saved') } : { ok: false, text: tCommon('genericError') });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="card flex items-center justify-center bg-slate-100 p-4">
        <canvas ref={canvas} className="max-h-[70vh] max-w-full rounded-lg shadow-surface" aria-label={t('preview')} role="img" />
      </div>
      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <div className="segmented w-full flex-wrap" role="radiogroup" aria-label={t('size')}>
            {(Object.keys(SIZES) as SizeKey[]).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={size === key} className={`segmented-item ${size === key ? 'segmented-item-active' : ''}`} onClick={() => setSize(key)}>
                {t(`size_${key}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {t('background')}
              <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} aria-label={t('background')} />
            </label>
            <label className="btn-secondary cursor-pointer">
              {t('photo')}
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => loadPhoto(event.target.files?.[0])} />
            </label>
            {photo && (
              <button type="button" className="text-sm text-slate-600 underline" onClick={() => setPhoto(null)}>
                {t('removePhoto')}
              </button>
            )}
          </div>
        </section>
        {layers.map((layer, index) => (
          <section key={index} className="card space-y-3 p-4">
            <label className="label" htmlFor={`layer-${index}`}>{t('text')}</label>
            <textarea id={`layer-${index}`} className="input" rows={2} value={layer.text} onChange={(event) => setLayer(index, { text: event.target.value })} />
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-700">
              <label>
                {t('textSize')}
                <input type="range" min={24} max={220} value={layer.size} className="w-full" onChange={(event) => setLayer(index, { size: Number(event.target.value) })} />
              </label>
              <label>
                {t('textColor')}
                <input type="color" value={layer.color} className="block" onChange={(event) => setLayer(index, { color: event.target.value })} />
              </label>
              <label>
                {t('horizontal')}
                <input type="range" min={0} max={100} value={layer.x} className="w-full" onChange={(event) => setLayer(index, { x: Number(event.target.value) })} />
              </label>
              <label>
                {t('vertical')}
                <input type="range" min={0} max={100} value={layer.y} className="w-full" onChange={(event) => setLayer(index, { y: Number(event.target.value) })} />
              </label>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={layer.bold} onChange={(event) => setLayer(index, { bold: event.target.checked })} />
                {t('bold')}
              </label>
              {layers.length > 1 && (
                <button type="button" className="text-sm text-slate-600 underline" onClick={() => setLayers((current) => current.filter((_, i) => i !== index))}>
                  {t('removeText')}
                </button>
              )}
            </div>
          </section>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setLayers((current) => [...current, { text: '', size: 64, color: '#ffffff', x: 50, y: 80, bold: false }])}>
          {t('addText')}
        </button>
        <button type="button" className="btn-primary w-full" disabled={saving} onClick={() => void save()}>
          {saving ? tCommon('working') : t('save')}
        </button>
        {status && (
          <p role="status" className={`text-sm ${status.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {status.text} {status.ok && <Link href="/compose" className="underline">{t('useInPost')}</Link>}
          </p>
        )}
      </div>
    </div>
  );
}
