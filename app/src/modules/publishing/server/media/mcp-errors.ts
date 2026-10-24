import { OperationError } from '@/lib/operation-error';
import { MediaStorageUnavailable, MediaValidationError } from './errors';

import { loadPublishingErrorText } from '../error-copy';

/** Keep the MCP image tools inside the same typed, safe failure boundary as the HTTP route. */
export async function withMediaErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  const errorText = await loadPublishingErrorText();
  try { return await operation(); }
  catch (error) {
    if (error instanceof OperationError) throw error;
    if (error instanceof MediaValidationError) throw new OperationError('invalid_request', errorText(`media_${error.code}`));
    if (error instanceof MediaStorageUnavailable) throw new OperationError('unavailable', errorText('media_storage'));
    throw new OperationError('upstream_failure', errorText('media_failed'));
  }
}
