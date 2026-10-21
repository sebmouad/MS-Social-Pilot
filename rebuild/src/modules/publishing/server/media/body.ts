import { loadPublishingErrorText } from '../error-copy';
import { MediaBodyTooLarge, MediaValidationError } from './errors';

export { MediaBodyTooLarge } from './errors';

export async function readBoundedImageForm(request: Request, maxBytes: number): Promise<FormData> {
  const errorText = await loadPublishingErrorText();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new MediaValidationError('invalid_limit', errorText);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new MediaBodyTooLarge(errorText);
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) throw new MediaValidationError('invalid_form', errorText);
  if (!request.body) throw new MediaValidationError('empty_body', errorText);
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MediaBodyTooLarge(errorText);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData();
  } catch {
    throw new MediaValidationError('invalid_form', errorText);
  }
}
