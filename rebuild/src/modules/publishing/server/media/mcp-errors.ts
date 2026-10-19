import { OperationError } from '@/lib/operation-error';
import { MediaStorageUnavailable, MediaValidationError } from './errors';

const FAILED = 'The image operation could not be completed. Please try again.';

/** Keep the MCP image tools inside the same typed, safe failure boundary as the HTTP route. */
export async function withMediaErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof OperationError) throw error;
    if (error instanceof MediaValidationError) throw new OperationError('invalid_request', error.message);
    if (error instanceof MediaStorageUnavailable) throw new OperationError('unavailable', error.message);
    throw new OperationError('upstream_failure', FAILED);
  }
}
