/** Next.js startup hook: load Root values that synchronous request guards need. */
export async function register() {
  // Import inside the runtime check so the bundler drops Node-only modules from the edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startPublicOriginRefresh } = await import('./server/request-origin');
    await startPublicOriginRefresh();
    const { startOperatorWatchdog } = await import('./modules/root/server/watchdog');
    await startOperatorWatchdog();
  }
}

/** Unhandled server render and route errors go to the self-hosted error recorder (Root › Errors). */
export async function onRequestError(error: unknown, request: { path?: string; method?: string }, context: { routerKind?: string; routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import inside the runtime check so the bundler drops Node-only modules from the edge build (dev compiles it too).
    const { reportRequestError } = await import('./server/errors/recorder');
    await reportRequestError(error, request, context);
  }
}
