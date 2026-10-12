/**
 * The Node half of `instrumentation.ts`, kept in its own module so the edge
 * bundle never reaches it.
 */
export async function checkEnvAtStartup(): Promise<void> {
  // `next build` loads instrumentation too — failing a build over a runtime
  // secret is exactly what `src/lib/env.ts` is careful not to do.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { validateEnv } = await import('./lib/env');
  try {
    validateEnv();
  } catch (error) {
    // In development a warning is enough: `next dev` is often started before
    // `.env` is finished, and the accessor throws again at the point of use.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[env] ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    throw error;
  }
}

/**
 * The one alert the worker cannot raise: that it has stopped. The web server
 * checks the worker's heartbeat every minute, in production only, and opens
 * or closes the "worker stopped" incident (src/lib/system-alerts.ts). The same
 * tick counts a minute of uptime for the root status page (src/lib/uptime.ts).
 */
export function watchWorkerHeartbeat(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.NODE_ENV !== 'production') return;
  const timer = setInterval(() => {
    void (async () => {
      try {
        const { ensureSettings } = await import('./lib/settings');
        const { applyChecks, checkWorker } = await import('./lib/system-alerts');
        await ensureSettings();
        await applyChecks([await checkWorker()]);
      } catch (error) {
        console.error('[alerts] heartbeat check failed', error);
      }
      try {
        const { recordUptimeMinute } = await import('./lib/uptime');
        await recordUptimeMinute();
      } catch (error) {
        console.error('[uptime] could not record', error);
      }
    })();
  }, 60_000);
  timer.unref();
}
