import { OperationError } from '@/lib/operation-error';

export class RequestBodyTooLarge extends OperationError {
  constructor() { super('invalid_request', 'This request is too large. Reduce the content and try again.'); }
}

/** Count actual streamed bytes: Content-Length is only an early refusal, never a trusted bound. */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('unavailable', 'This action is temporarily unavailable.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLarge();
  }
  if (!request.body) throw new OperationError('invalid_request', 'Enter valid details and try again.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new RequestBodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** JSON and UTF-8 are protocol rules; the operational byte ceiling is supplied by the owning module. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new OperationError('invalid_request', 'Send valid form details and try again.');
  const bytes = await readBoundedBytes(request, maxBytes);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new OperationError('invalid_request', 'Enter valid details and try again.'); }
}
