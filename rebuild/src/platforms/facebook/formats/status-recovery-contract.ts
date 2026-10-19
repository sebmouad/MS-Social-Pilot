import { createHash } from 'node:crypto';

export type NativeStatusEligibility = {
  format: string; state: string; remoteId: string | null; knownIds: unknown;
  steps: unknown;
  conflicted: boolean;
};

export const facebookNativeEvidenceId = (operationId: string) => `native:${createHash('sha256').update(operationId).digest('hex')}`;
export const facebookNativeStatusConfirmation = (operationId: string, revision: number) => `CHECK FACEBOOK STATUS ${facebookNativeEvidenceId(operationId)} AT REVISION ${revision}`;

export function facebookNativeStatusEligible(row: NativeStatusEligibility): boolean {
  const phases = row.format === 'video' ? ['video_create'] : row.format === 'reel' ? ['upload_start', 'upload_transfer', 'reel_finish'] : [];
  return phases.length > 0 && row.conflicted === false && ['published', 'uncertain'].includes(row.state) &&
    typeof row.remoteId === 'string' && !!row.remoteId && Array.isArray(row.knownIds) && row.knownIds.length === 1 && row.knownIds[0] === row.remoteId &&
    Array.isArray(row.steps) && row.steps.length === phases.length && row.steps.every((step, index) =>
      step !== null && typeof step === 'object' && step.phase === phases[index] && step.dispatched === true && step.confirmed === true);
}

