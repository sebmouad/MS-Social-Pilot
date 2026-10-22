import type { ImagePort, ListedModel, VoicePort } from './media-ports';
import { readBounded, upstream } from './media-ports';

type Settings = { apiKey: string; endpoint: string; modelsEndpoint: string; maxBytes: number; fetchImpl?: typeof fetch };

async function listModels(s: Settings, signal: AbortSignal): Promise<ListedModel[]> {
  const doFetch = s.fetchImpl ?? fetch;
  let response: Response;
  try { response = await doFetch(s.modelsEndpoint, { headers: { authorization: `Bearer ${s.apiKey}` }, signal, redirect: 'error', cache: 'no-store' }); } catch { throw upstream(); }
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw upstream(); }
  const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown; created?: unknown }> } | null;
  return (Array.isArray(body?.data) ? body.data : []).flatMap(item => typeof item.id === 'string' ? [{ id: item.id, created: typeof item.created === 'number' ? item.created : 0 }] : []);
}

async function post(s: Settings, payload: unknown, signal: AbortSignal): Promise<Response> {
  const doFetch = s.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(s.endpoint, { method: 'POST', signal, redirect: 'error', cache: 'no-store', headers: { authorization: `Bearer ${s.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch { throw upstream(); }
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw upstream(); }
  return response;
}

/** OpenAI image generation adapter. Key, endpoints and model are Root settings. */
export function openaiImagePort(s: Settings): ImagePort {
  return {
    listModels: signal => listModels(s, signal),
    async generate({ model, prompt, size, signal }) {
      const response = await post(s, { model, prompt, size, n: 1 }, signal);
      const body = await response.json().catch(() => null) as { data?: Array<{ b64_json?: unknown }> } | null;
      const encoded = body?.data?.[0]?.b64_json;
      // Only inline picture data is accepted: following a provider-supplied address would be an outbound fetch of untrusted input.
      if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(s.maxBytes * 4 / 3) + 8) throw upstream();
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > s.maxBytes) throw upstream();
      return bytes;
    },
  };
}

/** OpenAI speech adapter. */
export function openaiVoicePort(s: Settings): VoicePort {
  return {
    listModels: signal => listModels(s, signal),
    async speak({ model, text, voice, format, signal }) {
      const response = await post(s, { model, input: text, voice, response_format: format }, signal);
      const bytes = await readBounded(response, s.maxBytes);
      if (!bytes.length) throw upstream();
      return bytes;
    },
  };
}
