/** Next.js startup hook: load Root values that synchronous request guards need. */
export async function register() {
  // Import inside the runtime check so the bundler drops Node-only modules from the edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPublicOriginRefresh } = await import('./server/request-origin');
    await startPublicOriginRefresh();
  }
}
