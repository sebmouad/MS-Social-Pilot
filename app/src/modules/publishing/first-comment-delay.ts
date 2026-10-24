import { OperationError } from '@/lib/operation-error';

/** Parse an optional authoring value against the active Root-configured ceiling. */
export function parseFirstCommentDelay(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new OperationError('unavailable', 'The first-comment delay limit is unavailable.');
  }
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new OperationError('invalid_request', `Enter a whole number of minutes from 0 to ${maximum}.`);
  }
  return parsed;
}
