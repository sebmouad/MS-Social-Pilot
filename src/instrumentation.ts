/**
 * Runs once when a Next.js server starts.
 *
 * Used for one thing: refusing to boot with an environment that would fail the
 * first request. Without this a missing or too-short `SESSION_SECRET` surfaces
 * as a 500 on whichever page somebody opens first, long after the deploy that
 * caused it looked healthy.
 */
export async function register(): Promise<void> {
  // Node only, and written as a condition around the import rather than an
  // early return: Next replaces `NEXT_RUNTIME` at compile time, so the edge
  // bundle drops this branch — and with it `env.ts` and the `node:` modules it
  // pulls in, which the edge compiler cannot resolve. After an early return the
  // import would still be bundled, and the build fails.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkEnvAtStartup } = await import('./instrumentation-node');
    await checkEnvAtStartup();
  }
}
