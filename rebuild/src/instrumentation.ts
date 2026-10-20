/** Next.js startup hook: load Root values that synchronous request guards need. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startPublicOriginRefresh } = await import('@/server/request-origin');
  await startPublicOriginRefresh();
}
