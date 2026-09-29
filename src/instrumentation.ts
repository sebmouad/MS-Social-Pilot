/**
 * Runs once when a Next.js server starts.
 *
 * Used for one thing: refusing to boot with an environment that would fail the
 * first request. Without this a missing or too-short `SESSION_SECRET` surfaces
 * as a 500 on whichever page somebody opens first, long after the deploy that
 * caused it looked healthy.
 */
export async function register(): Promise<void> {
  // Node only: the edge runtime has no use for these secrets, and `next build`
  // loads this file too — failing a build over a runtime secret is exactly
  // what `src/lib/env.ts` is careful not to do.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
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
