import type { BadgeTone } from '@/components/Badge';

/**
 * Badge tone for a stored Ads object status. Provider status words arrive in
 * stored inventory (ACTIVE, PAUSED, DELETED, …); matching is
 * case-insensitive and unknown or missing values stay neutral. The status
 * text itself still carries the meaning.
 */
export function adsStatusTone(status: string | null | undefined): BadgeTone {
  const value = (status ?? '').trim().toUpperCase();
  if (!value) return 'neutral';
  if (/(DELETED|ARCHIVED|DISAPPROVED|REJECTED|FAILED|ERROR)/.test(value)) return 'danger';
  if (/(ACTIVE|ENABLED|RUNNING|LIVE|DELIVERING|APPROVED|COMPLETED)/.test(value)) return 'success';
  return 'neutral';
}
