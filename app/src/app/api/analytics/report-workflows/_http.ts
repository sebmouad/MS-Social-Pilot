/** Report routes reuse the installed Analytics HTTP adapter. */
export * from '@/modules/analytics/http';
import { runtimeConfig } from '@/server/config/store';
import { readBoundedJson } from '@/server/http/body';
export async function reportBody(request: Request): Promise<unknown> {
  return readBoundedJson(request, await runtimeConfig('analytics.reports.requestMaxBytes'));
}
