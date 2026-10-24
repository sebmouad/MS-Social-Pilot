import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { changeWatermark, readWatermark } from './service';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function handle(request: Request, write: boolean) {
  try {
    if (new URL(request.url).search) throw new OperationError('invalid_request', 'URL parameters are not accepted.');
    if (write) {
      let same = false;
      try { same = new URL(request.headers.get('origin') ?? '').origin === requestOrigin(request); } catch {}
      if (!same) throw new OperationError('forbidden', 'Cross-origin request denied.');
    }
    // Request authentication precedes bounded body parsing. The service chooses and rechecks feature authority.
    const viewer = await requireViewer();
    let input: unknown;
    if (write) {
      const limit = Math.ceil(Number(await runtimeConfig('settings.watermarkMaxLogoBytes')) / 3) * 4 + 4096;
      const reader = request.body?.getReader();
      if (!reader) throw new OperationError('invalid_request', 'A JSON body is required.');
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.length;
          if (length > limit) { await reader.cancel(); throw new OperationError('invalid_request', 'The logo upload is too large.'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    return reply(write ? await changeWatermark(actor, input) : await readWatermark(actor));
  } catch (error) {
    const failure = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Watermarking is unavailable.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
