import { defaultAdsText } from '@/modules/ads/copy';
import { requestOrigin } from '@/server/request-origin';
import { OperationError } from '@/lib/operation-error';

/** Convert URL search params to a strict record: no repeated keys, integer keys parsed strictly. */
export function searchRecord(url: string, integerKeys: readonly string[] = []): Record<string, unknown> {
  const params = new URL(url).searchParams;
  const out: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    if (all.length !== 1) throw new OperationError('invalid_request', defaultAdsText('validation044'));
    const value = all[0]!;
    out[key] = integerKeys.includes(key) ? (/^\d{1,15}$/.test(value) ? Number(value) : value) : value;
  }
  return out;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

/** Validate Next.js page searchParams without silently selecting or dropping values. */
export function pageSearchRecord(
  params: Record<string, string | string[] | undefined>,
  allowedKeys: readonly string[],
  maxCharacters: number,
): Record<string, string | undefined> {
  if (Object.keys(params).some(key => !allowedKeys.includes(key))) throw new OperationError('invalid_request', defaultAdsText('validation045'));
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length !== 1) throw new OperationError('invalid_request', defaultAdsText('validation046'));
      out[key] = value[0];
    } else out[key] = value;
    if (out[key]!.length > maxCharacters) throw new OperationError('invalid_request', defaultAdsText('validation047', { value0: maxCharacters }));
  }
  if (out.offset !== undefined && (!/^\d{1,9}$/.test(out.offset) || !Number.isSafeInteger(Number(out.offset)))) {
    throw new OperationError('invalid_request', defaultAdsText('validation048'));
  }
  return out;
}
