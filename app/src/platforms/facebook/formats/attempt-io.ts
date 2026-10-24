import { FacebookAttemptStoreUnavailableError } from './types';
import type { FacebookNativeAttemptStore } from './types';

/** Attempt-store reads/begins fail closed with the shared error; nothing is sent. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch { throw new FacebookAttemptStoreUnavailableError(); }
}
/** Recording after a send is best-effort: a failed write must never change or hide a remote outcome. */
export async function record(attempts: FacebookNativeAttemptStore, id: string, patch: Parameters<FacebookNativeAttemptStore['update']>[1], expectedStates?: Parameters<FacebookNativeAttemptStore['update']>[2]): Promise<void> {
  try { await attempts.update(id, patch, expectedStates); } catch { /* row stays in its last durable state; reconciliation treats it as uncertain */ }
}
