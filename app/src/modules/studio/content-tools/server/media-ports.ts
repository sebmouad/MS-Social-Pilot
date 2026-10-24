import { OperationError } from '@/lib/operation-error';

/**
 * Provider ports for pictures, speech and video. A port takes plain arguments and returns bytes or a
 * small state; it never sees workspace data beyond them, and its failures never carry provider text.
 */
export type ListedModel = { id: string; created: number };
export type VideoState = { state: 'working' } | { state: 'failed' } | { state: 'refused' } | { state: 'done'; uri: string };

export interface ImagePort {
  listModels(signal: AbortSignal): Promise<ListedModel[]>;
  generate(input: { model: string; prompt: string; size: string; signal: AbortSignal }): Promise<Buffer>;
}
export interface VoicePort {
  listModels(signal: AbortSignal): Promise<ListedModel[]>;
  speak(input: { model: string; text: string; voice: string; format: string; signal: AbortSignal }): Promise<Buffer>;
}
export interface VideoPort {
  listModels(signal: AbortSignal): Promise<ListedModel[]>;
  start(input: { model: string; prompt: string; aspectRatio: string; signal: AbortSignal }): Promise<string>;
  poll(operation: string, signal: AbortSignal): Promise<VideoState>;
  download(uri: string, maxBytes: number, signal: AbortSignal): Promise<Buffer>;
}
export type MediaPorts = { image?: ImagePort; voice?: VoicePort; video?: VideoPort };

export const upstream = () => new OperationError('upstream_failure', 'The AI service could not finish this request.');

/** The configured model, or the newest listed one that matches the pattern (and not the exclusion, unless nothing else matches). */
export function pickModel(configured: string, listed: readonly ListedModel[], pattern: string, exclude?: string): string | null {
  if (configured) return configured;
  const match = new RegExp(pattern, 'i');
  const matching = listed.filter(model => match.test(model.id));
  const kept = exclude ? matching.filter(model => !new RegExp(exclude, 'i').test(model.id)) : matching;
  const pool = kept.length ? kept : matching;
  return [...pool].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id, 'en', { numeric: true }))[0]?.id ?? null;
}

/** Read a bounded response body so a hostile or broken upstream cannot exhaust memory. */
export async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) { void response.body?.cancel().catch(() => undefined); throw upstream(); }
  const reader = response.body?.getReader();
  if (!reader) throw upstream();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { void reader.cancel().catch(() => undefined); throw upstream(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
