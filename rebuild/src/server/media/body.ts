/** Bound the complete multipart envelope before parsing it into memory. */
export class MediaBodyTooLarge extends Error {}

export async function readBoundedImageForm(request: Request, maxBytes: number): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid media request limit.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new MediaBodyTooLarge('Image request exceeds the configured size limit.');
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) throw new Error('Upload an image using a multipart form.');
  if (!request.body) throw new Error('Image request is empty.');
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
        throw new MediaBodyTooLarge('Image request exceeds the configured size limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData();
}
