/** Stops awaiting at the suite deadline; provider transports also receive this signal. */
export function withinDiagnosticDeadline<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
/** A saved shorter recovery policy cannot permit overlap before the original deadline/audit grace. */
export const diagnosticRecoverySeconds = (configuredSeconds: number, runTimeoutMs: number, databaseTimeoutMs: number) => Math.max(configuredSeconds, Math.ceil((runTimeoutMs + databaseTimeoutMs * 2) / 1000));
