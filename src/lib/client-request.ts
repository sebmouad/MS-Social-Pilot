/** Browser-only transport contract. Mutations are never retried automatically. */
export type RequestOutcome<T> = { ok: true; data: T } | {
  ok: false; kind: 'http' | 'transport' | 'response'; status?: number;
  error?: string; fields?: Record<string, string>; traceId?: string;
};
export async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<RequestOutcome<T>> {
  let response: Response;
  try { response = await fetch(url, init); } catch { return { ok: false, kind: 'transport' }; }
  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    return { ok: false, kind: response.ok ? 'response' : 'http', status: response.status };
  }
  if (response.ok) return { ok: true, data: body as T };
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return { ok: false, kind: 'http', status: response.status,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(value.fields && typeof value.fields === 'object' ? { fields: value.fields as Record<string, string> } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
  };
}
