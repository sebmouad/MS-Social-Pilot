/**
 * Image rules applied at publish time (NEXT_PHASES G13): the per-Page
 * watermark and the aspect ratios each destination accepts. Plain module, so
 * the Page settings preview can use the same rules as the worker.
 */

export const WATERMARK_POSITIONS = ['top-start', 'top-end', 'center', 'bottom-start', 'bottom-end'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export interface Watermark {
  /** A library image used as the logo; wins over text when both are set. */
  mediaId?: string;
  text?: string;
  position: WatermarkPosition;
  /** 10–100 %. */
  opacity: number;
  /** Logo width or text height, as a share of the image width: 5–40 %. */
  size: number;
}

export const WATERMARK_DEFAULTS: Watermark = { position: 'bottom-end', opacity: 70, size: 15 };

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** A stored or submitted watermark, cleaned; null when there is nothing to draw. */
export function parseWatermark(value: unknown): Watermark | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const mediaId = typeof raw.mediaId === 'string' && raw.mediaId.trim() ? raw.mediaId.trim() : undefined;
  const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim().slice(0, 80) : undefined;
  if (!mediaId && !text) return null;
  return {
    ...(mediaId ? { mediaId } : {}),
    ...(text ? { text } : {}),
    position: WATERMARK_POSITIONS.includes(raw.position as WatermarkPosition)
      ? (raw.position as WatermarkPosition)
      : WATERMARK_DEFAULTS.position,
    opacity: clamp(raw.opacity, 10, 100, WATERMARK_DEFAULTS.opacity),
    size: clamp(raw.size, 5, 40, WATERMARK_DEFAULTS.size),
  };
}

/** Width ÷ height a destination accepts; null when it takes any shape. */
export interface AspectRange {
  min: number;
  max: number;
}

/**
 * Stories are full-screen 9:16 everywhere; an Instagram feed post refuses
 * anything taller than 4:5 or wider than 1.91:1. The other networks take
 * images as they are.
 */
export function aspectRangeFor(targetType: string, format: string): AspectRange | null {
  if (format === 'story') return { min: 9 / 16, max: 9 / 16 };
  if (targetType === 'instagram') return { min: 4 / 5, max: 1.91 };
  return null;
}

/** Where on the image the subject is, 0–1 from the start and the top. */
export interface FocalPoint {
  x: number;
  y: number;
}

/**
 * The largest box inside the image whose shape is in range, centred on the
 * focal point as far as the edges allow. Null when the image already fits
 * (within 1 %, so a 1080×1351 photo is not shaved by a pixel).
 */
export function cropBox(
  width: number,
  height: number,
  range: AspectRange,
  focus: FocalPoint = { x: 0.5, y: 0.5 },
): { left: number; top: number; width: number; height: number } | null {
  const ratio = width / height;
  if (ratio >= range.min * 0.99 && ratio <= range.max * 1.01) return null;

  const target = ratio < range.min ? range.min : range.max;
  const boxWidth = ratio > target ? Math.round(height * target) : width;
  const boxHeight = ratio > target ? height : Math.round(width / target);
  const place = (size: number, box: number, at: number) =>
    Math.min(size - box, Math.max(0, Math.round(at * size - box / 2)));
  return {
    left: place(width, boxWidth, Math.min(1, Math.max(0, focus.x))),
    top: place(height, boxHeight, Math.min(1, Math.max(0, focus.y))),
    width: boxWidth,
    height: boxHeight,
  };
}
