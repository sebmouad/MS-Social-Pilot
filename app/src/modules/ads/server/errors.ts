import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { loadAdsCopy } from './copy';
import { localizeAdsMessage } from '../copy';
import { defaultAdsText } from '@/modules/ads/copy';
import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { AdsNoDispatchError, adsNoDispatchMetadata, asNoDispatch } from '@/modules/ads/management/errors';
import { platformAdsLocale, withPlatformAdsLocale } from '@/server/platforms/host';

const FAILED = defaultAdsText('validation001');

/**
 * API and MCP expose only intentional product errors, never provider exceptions. A typed no-dispatch refusal
 * keeps its safe marker (it describes this send only); any other failure is reduced to code and message.
 */
export async function withAdsErrorBoundary<T>(operation: () => Promise<T>, locale: 'en' | 'fr' = platformAdsLocale()): Promise<T> {
  return withPlatformAdsLocale(locale, () => withAdsCopySnapshot(async () => {
  const effectiveLocale = platformAdsLocale();
  try { return await operation(); }
  catch (error) {
    if (error instanceof AdsNoDispatchError) { error.message = localizeAdsMessage(await loadAdsCopy(), effectiveLocale, error.message); throw error; }
    const failure = operationFailure(error, FAILED);
    throw new OperationError(failure.code, localizeAdsMessage(await loadAdsCopy(), effectiveLocale, failure.error));
  }

  }));
}

export async function adsErrorResponse(error: unknown, invalidRequestMessage: string, locale: 'en' | 'fr' = platformAdsLocale()) {
  return withAdsCopySnapshot(async () => {
  // A malformed body is refused before any service call, so this send provably dispatched nothing.
  const reported = error instanceof z.ZodError || error instanceof SyntaxError
    ? asNoDispatch(new OperationError('invalid_request', invalidRequestMessage)) : error;
  const failure = operationFailure(reported, FAILED);
  return Response.json({ error: localizeAdsMessage(await loadAdsCopy(), locale, failure.error), code: failure.code, ...adsNoDispatchMetadata(reported) }, { status: failure.status, headers: { 'cache-control': 'no-store' } });

  });
}
