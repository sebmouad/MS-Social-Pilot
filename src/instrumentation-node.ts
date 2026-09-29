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
