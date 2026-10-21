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

/** Shared protocol vocabulary for client receipt validation and server errors. */
export function isOperationErrorCode(value: unknown): value is OperationErrorCode {
  return typeof value === 'string' && Object.hasOwn(HTTP_STATUS, value);
}

/**
 * A session guard that calls Next's `redirect()` inside an API handler's try block
 * is an authorization outcome, not an upstream failure. `/access-limited` means a
 * signed-in member lacks access; any other target means no usable session.
 */
function guardRedirect(error: unknown): OperationError | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT;')) return null;
  return digest.split(';')[2] === '/access-limited'
    ? new OperationError('forbidden', 'You do not have access to this feature.')
    : new OperationError('unauthorized', 'Sign in to an authorized workspace.');
}

export function operationFailure(error: unknown, fallback: string) {
  const safe = error instanceof OperationError ? error : guardRedirect(error) ?? new OperationError('upstream_failure', fallback);
  return { error: safe.message, code: safe.code, status: HTTP_STATUS[safe.code] };
}
