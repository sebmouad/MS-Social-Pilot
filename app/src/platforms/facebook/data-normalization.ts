/** Preserve nested dimension identity rather than discarding non-scalar insight values. */
export function facebookInsightCategories(value: unknown, path: string[] = []): Array<{ label: string; value: number | null }> {
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => facebookInsightCategories(child, [...path, key]));
  }
  const number = typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  return [{ label: path.join(' · '), value: number }];
}
