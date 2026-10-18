import { OperationError, type OperationErrorCode } from '@/lib/operation-error';

/** Why a creation transmission was refused before any advertising platform request was sent. */
export type AdsNoDispatchReason = 'blocked_by_other_request';

/**
 * A refusal of THIS transmission that happened before provider dispatch and before this transmission
 * recorded an intent. It is a claim about one send only. It does NOT say that no earlier send of the same
 * request id was recorded, dispatched, succeeded or is unknown, and it never describes an intent commit
 * whose outcome could not be observed. Callers holding an earlier unresolved send must keep it held.
 */
export class AdsNoDispatchError extends OperationError {
  readonly dispatched = false as const;
  constructor(code: OperationErrorCode, message: string, readonly reason?: AdsNoDispatchReason) {
    super(code, message);
    this.name = 'AdsNoDispatchError';
  }
}

/**
 * Mark a failure raised by this transmission's own preflight (before its intent transaction). Nothing there
 * performs provider I/O, so an unexpected error is also a refusal of this send, with generic copy.
 */
export function asNoDispatch(error: unknown): AdsNoDispatchError {
  if (error instanceof AdsNoDispatchError) return error;
  if (error instanceof OperationError) return new AdsNoDispatchError(error.code, error.message);
  return new AdsNoDispatchError('unavailable', 'Advertising changes are temporarily unavailable. Try again later.');
}

export type AdsNoDispatchMetadata = { attempt?: 'not_dispatched'; reason?: AdsNoDispatchReason };

/** Safe wire-level metadata; empty unless this transmission is proven not to have reached the provider. */
export function adsNoDispatchMetadata(error: unknown): AdsNoDispatchMetadata {
  return error instanceof AdsNoDispatchError ? { attempt: 'not_dispatched', ...(error.reason ? { reason: error.reason } : {}) } : {};
}
