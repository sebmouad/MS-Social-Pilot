import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';

/** Workspace-zone display labels for the owner link manager (see `@/server/instant-labels`). */
export async function labelShareLinks<T extends { links: object[] }>(page: T, workspaceId: string, locale: 'en' | 'fr') {
  const instants = await workspaceInstantFormatter(workspaceId, locale);
  return { ...page, links: page.links.map(link => labelInstants(link, { expiresAt: 'date' }, instants)) };
}
export async function labelShareFeedback<T extends { feedback: object[] }>(page: T, workspaceId: string, locale: 'en' | 'fr') {
  const instants = await workspaceInstantFormatter(workspaceId, locale);
  return { ...page, feedback: page.feedback.map(item => labelInstants(item, { createdAt: 'dateTime' }, instants)) };
}
export const acceptLocale = (request: Request): 'en' | 'fr' => /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';
