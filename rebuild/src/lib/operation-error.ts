/** Explicitly safe product failures. Never construct one from raw provider text. */
export type OperationErrorCode = 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'unavailable' | 'reconnect_required' | 'conflict' | 'upstream_failure';

export class OperationError extends Error {
  constructor(readonly code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

/** HTTP protocol mappings, not provider-specific codes or configurable policy. */
const HTTP_STATUS: Record<OperationErrorCode, number> = {
  invalid_request: 400, unauthorized: 401, forbidden: 403, not_found: 404,
  unavailable: 409, reconnect_required: 409, conflict: 409, upstream_failure: 502,
};

export function operationFailure(error: unknown, fallback: string) {
  const safe = error instanceof OperationError ? error : new OperationError('upstream_failure', fallback);
  return { error: safe.message, code: safe.code, status: HTTP_STATUS[safe.code] };
}
