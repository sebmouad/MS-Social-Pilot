import { createHash } from 'node:crypto';

export type NativeStatusEligibility = {
  format: string; state: string; remoteId: string | null; knownIds: unknown;
  steps: unknown;
  conflicted: boolean;
};

export const facebookNativeEvidenceId = (operationId: string) => `native:${createHash('sha256').update(operationId).digest('hex')}`;
export const facebookNativeStatusConfirmation = (operationId: string, revision: number) => `CHECK FACEBOOK STATUS ${facebookNativeEvidenceId(operationId)} AT REVISION ${revision}`;

export function facebookNativeStatusEligible(row: NativeStatusEligibility): boolean {
  const phases = row.format === 'video' ? ['video_create'] : row.format === 'reel' ? ['upload_start', 'upload_transfer', 'reel_finish']
    : row.format === 'story_photo' ? ['photo_upload', 'story_create'] : row.format === 'story_video' ? ['upload_start', 'upload_transfer', 'story_finish'] : [];
  // A Story journals its staged media beside the final Story identity; Video and Reel journal only the final one.
  const story = row.format === 'story_photo' || row.format === 'story_video';
  const identities = Array.isArray(row.knownIds) && (story
    ? row.knownIds.length === 2 && new Set(row.knownIds).size === 2 && row.knownIds.includes(row.remoteId)
    : row.knownIds.length === 1 && row.knownIds[0] === row.remoteId);
  return phases.length > 0 && row.conflicted === false && ['published', 'uncertain'].includes(row.state) &&
    typeof row.remoteId === 'string' && !!row.remoteId && identities &&
    Array.isArray(row.steps) && row.steps.length === phases.length && row.steps.every((step, index) =>
      step !== null && typeof step === 'object' && step.phase === phases[index] && step.dispatched === true && step.confirmed === true);
}

