/** Registry values use their visible form representation for dirty detection. */
export function configText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === undefined || value === null ? '' : String(value);
}
export function updateConfigDraft(current: Record<string, unknown>, key: string, value: unknown, original: unknown, secret = false) {
  const next = { ...current };
  if ((secret && value === '') || (!secret && configText(value) === configText(original))) delete next[key];
  else next[key] = value;
  return next;
}
