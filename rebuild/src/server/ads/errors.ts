import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';

const FAILED = 'The advertising action could not be completed. Check the connection and try again.';

/** API and MCP expose only intentional product errors, never provider exceptions. */
export async function withAdsErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const failure = operationFailure(error, FAILED);
    throw new OperationError(failure.code, failure.error);
  }
}

export function adsErrorResponse(error: unknown, invalidRequestMessage: string) {
  const failure = operationFailure(error instanceof z.ZodError || error instanceof SyntaxError
    ? new OperationError('invalid_request', invalidRequestMessage) : error, FAILED);
  return Response.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
}
