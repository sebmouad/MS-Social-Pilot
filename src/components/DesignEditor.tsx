'use client';

import { onRadioGroupKeyDown } from '@/lib/segmented-radio';

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
const SHAPES = ['none', 'band', 'frame', 'circle'] as const;
type Shape = (typeof SHAPES)[number];

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
export function DesignEditor({
  canGenerate = false,
  brand = { color: null, logo: null },
}: {
  canGenerate?: boolean;
  /** The workspace's report colour and logo (Settings › Reports), offered as one click here. */
  brand?: { color: string | null; logo: string | null };
}) {
  const t = useTranslations('design');
  const tCommon = useTranslations('common');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<SizeKey>('square');
  const [background, setBackground] = useState('#1877f2');
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([{ text: '', size: 96, color: '#ffffff', x: 50, y: 50, bold: true }]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [shape, setShape] = useState<Shape>('none');
  const [shapeColor, setShapeColor] = useState('#000000');
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);

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
    // A shape sits between the background and the text, so text stays readable on a photo.
    context.fillStyle = shapeColor;
    context.strokeStyle = shapeColor;
    if (shape === 'band') {
      context.globalAlpha = 0.75;
      context.fillRect(0, h * 0.65, w, h * 0.3);
      context.globalAlpha = 1;
    } else if (shape === 'frame') {
      context.lineWidth = w * 0.03;
      context.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    } else if (shape === 'circle') {
      context.globalAlpha = 0.75;
      context.beginPath();
      context.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
    if (logo) {
      const side = Math.min(w, h) * 0.14;
      const scale = Math.min(side / logo.width, side / logo.height);
      context.drawImage(logo, w - logo.width * scale - w * 0.04, h - logo.height * scale - h * 0.04, logo.width * scale, logo.height * scale);
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
  }, [size, background, photo, layers, shape, shapeColor, logo]);

  useEffect(draw, [draw]);

  function loadPhoto(file: File | undefined) {
    if (!file) return;
    const image = new Image();
    image.onload = () => setPhoto(image);
    image.src = URL.createObjectURL(file);
  }

  function toggleLogo() {
    if (logo || !brand.logo) return setLogo(null);
    const image = new Image();
    // Without CORS the canvas could not be saved, so a logo that refuses it is not added.
    image.crossOrigin = 'anonymous';
    image.onload = () => setLogo(image);
    image.onerror = () => setStatus({ ok: false, text: t('logoFailed') });
    image.src = brand.logo;
  }

  /** Starting points: a layout, then the user edits the words. */
  function applyTemplate(name: 'quote' | 'announcement' | 'banner') {
    const accent = brand.color ?? '#1877f2';
    setPhoto(null);
    if (name === 'quote') {
      setBackground('#111827');
      setShape('frame');
      setShapeColor(accent);
      setLayers([{ text: t('templateQuoteText'), size: 84, color: '#ffffff', x: 50, y: 45, bold: false }, { text: t('templateQuoteAuthor'), size: 48, color: accent, x: 50, y: 75, bold: true }]);
    } else if (name === 'announcement') {
      setBackground(accent);
      setShape('circle');
      setShapeColor('#ffffff');
      setLayers([{ text: t('templateAnnouncementText'), size: 110, color: '#111827', x: 50, y: 50, bold: true }]);
    } else {
      setBackground('#f0f2f5');
      setShape('band');
      setShapeColor(accent);
      setLayers([{ text: t('templateBannerText'), size: 96, color: '#ffffff', x: 50, y: 80, bold: true }]);
    }
  }

  const setLayer = (index: number, patch: Partial<Layer>) => setLayers((current) => current.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)));

  async function generate() {
    setGenerating(true);
    setStatus(null);
    const shape = size === 'portrait' || size === 'story' ? 'portrait' : size === 'landscape' ? 'landscape' : 'square';
    const response = await fetch('/api/ai/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, size: shape }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (!response?.ok || !body?.url) {
      setGenerating(false);
      return setStatus({ ok: false, text: body?.error ?? tCommon('genericError') });
    }
    const image = new Image();
    image.onload = () => {
      setPhoto(image);
      setGenerating(false);
    };
    image.onerror = () => {
      setGenerating(false);
      setStatus({ ok: false, text: tCommon('genericError') });
    };
    image.src = body.url;
  }

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
        <canvas ref={canvas} className="max-h-[40vh] max-w-full lg:max-h-[70vh] rounded-lg shadow-surface" aria-label={t('preview')} role="img" />
      </div>
      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <div className="segmented grid w-full grid-cols-2 gap-1" role="radiogroup" onKeyDown={onRadioGroupKeyDown} aria-label={t('size')}>
            {(Object.keys(SIZES) as SizeKey[]).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={size === key} tabIndex={size === key ? 0 : -1} className={`segmented-item ${size === key ? 'segmented-item-active' : ''}`} onClick={() => setSize(key)}>
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
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {t('shape')}
              <select className="input w-auto" value={shape} onChange={(event) => setShape(event.target.value as Shape)}>
                {SHAPES.map((key) => (
                  <option key={key} value={key}>{t(`shape_${key}`)}</option>
                ))}
              </select>
            </label>
            {shape !== 'none' && <input type="color" value={shapeColor} onChange={(event) => setShapeColor(event.target.value)} aria-label={t('shapeColor')} />}
          </div>
          {(brand.color || brand.logo) && (
            <div className="flex flex-wrap items-center gap-3">
              {brand.color && (
                <button type="button" className="btn-secondary" onClick={() => setBackground(brand.color!)}>
                  <span aria-hidden className="h-4 w-4 rounded-full ring-1 ring-slate-300" style={{ background: brand.color }} />
                  {t('brandColor')}
                </button>
              )}
              {brand.logo && (
                <button type="button" className="btn-secondary" aria-pressed={!!logo} onClick={toggleLogo}>
                  {logo ? t('removeLogo') : t('addLogo')}
                </button>
              )}
            </div>
          )}
        </section>
        <section className="card space-y-2 p-4">
          <p className="label">{t('templates')}</p>
          <div className="flex flex-wrap gap-2">
            {(['quote', 'announcement', 'banner'] as const).map((name) => (
              <button key={name} type="button" className="btn-secondary" onClick={() => applyTemplate(name)}>
                {t(`template_${name}`)}
              </button>
            ))}
          </div>
        </section>
        {canGenerate && (
          <section className="card space-y-2 p-4">
            <label className="label" htmlFor="design-prompt">{t('generate')}</label>
            <textarea id="design-prompt" className="input" rows={2} maxLength={1000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('generatePlaceholder')} />
            <button type="button" className="btn-secondary w-full" disabled={generating || prompt.trim().length < 3} onClick={() => void generate()}>
              {generating ? tCommon('working') : t('generateButton')}
            </button>
            <p className="hint">{t('generateHint')}</p>
          </section>
        )}
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
