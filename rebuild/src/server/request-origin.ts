import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { runtimeConfig } from '@/server/config/store';

/**
 * The application's own public origin for same-origin (CSRF) checks and absolute links.
 *
 * Behind a reverse proxy `request.url` reports the internal listener (for example
 * `http://localhost:3100`), so browser `Origin` headers never match it. Root owns the
 * public value (`app.publicOrigin`); each process keeps it in memory, loaded at startup
 * by `instrumentation.ts`, refreshed every `app.publicOriginRefreshSeconds` and right
 * after a Root save. Empty means: use the address the server received (local development).
 */
// Next bundles instrumentation and each route separately; module variables are not shared,
// so the value lives on the process-wide global.
type OriginState = { value: string; timer?: ReturnType<typeof setTimeout> };
const state = ((globalThis as { __mspPublicOrigin?: OriginState }).__mspPublicOrigin ??= { value: '' });

export async function refreshPublicOrigin(): Promise<void> {
  try { state.value = String(await runtimeConfig('app.publicOrigin') ?? ''); }
  catch { /* keep the last known value */ }
}

export async function startPublicOriginRefresh(): Promise<void> {
  await refreshPublicOrigin();
  const schedule = async () => {
    let seconds = Number(CONFIG_BY_KEY.get('app.publicOriginRefreshSeconds')?.defaultValue);
    try { seconds = Number(await runtimeConfig('app.publicOriginRefreshSeconds')); } catch { /* keep the registry default */ }
    state.timer = setTimeout(async () => { await refreshPublicOrigin(); void schedule(); }, seconds * 1000);
    state.timer.unref?.();
  };
  if (!state.timer) void schedule();
}

export function requestOrigin(request: Request): string {
  return state.value || new URL(request.url).origin;
}
