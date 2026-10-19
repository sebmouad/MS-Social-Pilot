import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { AdsNoDispatchError, adsNoDispatchMetadata, asNoDispatch } from '@/modules/ads/management/errors';

const FAILED = 'The advertising action could not be completed. Check the connection and try again.';

/**
 * API and MCP expose only intentional product errors, never provider exceptions. A typed no-dispatch refusal
 * keeps its safe marker (it describes this send only); any other failure is reduced to code and message.
 */
export async function withAdsErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AdsNoDispatchError) throw error;
    const failure = operationFailure(error, FAILED);
    throw new OperationError(failure.code, failure.error);
  }
}

export function adsErrorResponse(error: unknown, invalidRequestMessage: string) {
  // A malformed body is refused before any service call, so this send provably dispatched nothing.
  const reported = error instanceof z.ZodError || error instanceof SyntaxError
    ? asNoDispatch(new OperationError('invalid_request', invalidRequestMessage)) : error;
  const failure = operationFailure(reported, FAILED);
  return Response.json({ error: failure.error, code: failure.code, ...adsNoDispatchMetadata(reported) }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
}
