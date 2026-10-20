import { applyConnectionHealthCopy } from '@/lib/connection-health';
import { SYNCHRONOUS_POLICY } from '@/lib/config/synchronous-policy';

import { applySynchronousPolicy } from '@/lib/config/synchronous-policy';
export { applySynchronousPolicy, synchronousPolicy } from '@/lib/config/synchronous-policy';

/** Startup/periodic reload, never a database read per hostile request. Failed reads retain the last valid policy. */
export async function refreshSynchronousPolicy(read: (key: string) => Promise<unknown>): Promise<void> {
  try { applyConnectionHealthCopy(await read('connections.healthCopy')); } catch { /* retain last validated catalog */ }
  await Promise.all(Object.keys(SYNCHRONOUS_POLICY).map(async key => {
    try { applySynchronousPolicy(key, await read(key)); } catch { /* retain validated snapshot/bootstrap default */ }
  }));
}
