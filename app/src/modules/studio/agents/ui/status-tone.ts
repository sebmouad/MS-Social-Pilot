import type { BadgeTone } from '@/components/Badge';

/**
 * Badge tone for a writing-agent run status. Completed runs confirm,
 * failed runs read as danger, and queued or working runs stay neutral.
 * The status label itself still carries the meaning.
 */
export function agentRunTone(status: string): BadgeTone {
  const value = status.trim().toLowerCase();
  if (value === 'completed') return 'success';
  if (value === 'failed') return 'danger';
  return 'neutral';
}
