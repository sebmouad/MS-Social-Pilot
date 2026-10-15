/** Pure helpers for the SVG charts. */

export type Tick = { value: number; label?: string };

/** Round axis bounds and ticks: the smallest 1/2/5×10ⁿ step that gives at most `count` intervals. */
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) { max = min + (min === 0 ? 1 : Math.abs(min) * 0.1); }
  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  const lower = Math.floor(min / step) * step;
  const upper = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lower; value <= upper + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return { min: lower, max: upper, ticks };
}

/** Indexes to label on the x axis: first, last and evenly spaced between, never more than `max`. */
export function labelIndexes(length: number, max: number): number[] {
  if (length <= 0) return [];
  if (length <= max) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, index) => Math.round(index * step)))];
}

/** SVG path commands for a line, broken into separate sub-paths wherever a value is missing. */
export function linePath(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let path = '';
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { drawing = false; return; }
    path += `${drawing ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

/** Index of the nearest day for a pointer x position inside the plot area. */
export function nearestIndex(pointerX: number, left: number, width: number, length: number): number {
  if (length <= 1 || width <= 0) return 0;
  const ratio = (pointerX - left) / width;
  return Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1))));
}

export type Extent = { min: number; max: number };

/** The smallest and largest value across several series, ignoring gaps. Includes zero so bars and areas have a baseline. */
export function extentOf(series: Array<Array<number | null>>, includeZero = true): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const values of series) for (const value of values) if (value !== null && Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  if (min === Infinity) return { min: 0, max: 1 };
  if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  return { min, max };
}
