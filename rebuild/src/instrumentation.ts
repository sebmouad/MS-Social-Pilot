/** Next.js startup hook: load Root values that synchronous request guards need. */
export async function register() {
  // Import inside the runtime check so the bundler drops Node-only modules from the edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPublicOriginRefresh } = await import('./server/request-origin');
    await startPublicOriginRefresh();
  }
}

/** Unhandled server render and route errors go to the self-hosted error recorder (Root › Errors). */
export async function onRequestError(error: unknown, request: { path?: string; method?: string }, context: { routerKind?: string; routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('./server/errors/recorder');
  await reportRequestError(error, request, context);
}
