import type { ListedModel, VideoPort, VideoState } from './media-ports';
import { readBounded, upstream } from './media-ports';

type Settings = { apiKey: string; baseEndpoint: string; fetchImpl?: typeof fetch };
/** The provider's operation name is later used as a path segment, so its shape is checked on the way in and out. */
const OPERATION = /^[A-Za-z0-9_./-]{1,300}$/;

/** Gemini (Veo) video adapter: long-running generation started once, polled until done, then downloaded. */
export function geminiVideoPort(s: Settings): VideoPort {
  const doFetch = s.fetchImpl ?? fetch;
  const base = s.baseEndpoint.replace(/\/+$/, '');
  const headers = { 'x-goog-api-key': s.apiKey, 'content-type': 'application/json' };
  async function json(url: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await doFetch(url, { ...init, headers, signal, redirect: 'error', cache: 'no-store' }); } catch { throw upstream(); }
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw upstream(); }
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') throw upstream();
    return body as Record<string, unknown>;
  }
  return {
    async listModels(signal): Promise<ListedModel[]> {
      const body = await json(`${base}/models?pageSize=1000`, {}, signal);
      const models = Array.isArray(body.models) ? body.models as Array<{ name?: unknown; supportedGenerationMethods?: unknown }> : [];
      return models.flatMap(model => typeof model.name === 'string' && Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('predictLongRunning') ? [{ id: model.name.replace(/^models\//, ''), created: 0 }] : []);
    },
    async start({ model, prompt, aspectRatio, signal }) {
      const body = await json(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, { method: 'POST', body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio } }) }, signal);
      if (typeof body.name !== 'string' || !OPERATION.test(body.name) || body.name.includes('..')) throw upstream();
      return body.name;
    },
    async poll(operation, signal): Promise<VideoState> {
      if (!OPERATION.test(operation) || operation.includes('..')) throw upstream();
      const state = await json(`${base}/${operation}`, {}, signal);
      if (state.done !== true) return { state: 'working' };
      if (state.error) return { state: 'failed' };
      const samples = (state.response as { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: unknown } }> } } | undefined)?.generateVideoResponse?.generatedSamples;
      const uri = samples?.[0]?.video?.uri;
      return typeof uri === 'string' && uri ? { state: 'done', uri } : { state: 'refused' };
    },
    async download(uri, maxBytes, signal) {
      // The finished file must come from the same provider host as the API; a different host is never fetched.
      let target: URL;
      try { target = new URL(uri); } catch { throw upstream(); }
      if (target.protocol !== 'https:' || target.host !== new URL(base).host) throw upstream();
      let response: Response;
      try { response = await doFetch(target, { headers: { 'x-goog-api-key': s.apiKey }, signal, redirect: 'follow', cache: 'no-store' }); } catch { throw upstream(); }
      if (!response.ok || new URL(response.url || target).protocol !== 'https:') { void response.body?.cancel().catch(() => undefined); throw upstream(); }
      return readBounded(response, maxBytes);
    },
  };
}
