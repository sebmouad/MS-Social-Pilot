import type { GrantGroupHealth } from '@/lib/connection-health';
import { runtimeConfig } from '@/server/config/store';

/**
 * Facebook's view of "which permissions does this connection still have".
 * The Meta permission names stay here: shared screens receive only the safe
 * group labels below, in the customer's language.
 */
export const facebookConnectionCopy = {
  en: {
    publishing: 'Publish posts', deleting: 'Delete published posts', firstComment: 'Add first comments',
    postStatus: 'Check how posts are doing', insights: 'Read page performance', inbox: 'Read and answer messages and comments',
    adsReporting: 'See ad results', adsManagement: 'Manage ads',
  },
  fr: {
    publishing: 'Publier des publications', deleting: 'Supprimer des publications publiées', firstComment: 'Ajouter des premiers commentaires',
    postStatus: 'Suivre l’état des publications', insights: 'Lire les performances de la Page', inbox: 'Lire et répondre aux messages et commentaires',
    adsReporting: 'Voir les résultats publicitaires', adsManagement: 'Gérer les publicités',
  },
} as const;
export type FacebookConnectionLocale = keyof typeof facebookConnectionCopy;
type GroupId = keyof typeof facebookConnectionCopy.en;

export interface FacebookGrantRequirements {
  publishing: readonly string[]; deleting: readonly string[]; firstComment: readonly string[]; postStatus: readonly string[];
  insights: readonly string[]; inboxRead: readonly string[]; inboxWrite: readonly string[];
  adsReporting: readonly string[]; adsManagement: readonly string[]; adsManagementEnabled: boolean;
}

/** Stored scopes are a comma list; an empty value means they were never recorded. */
export function parseGrantedScopes(stored: string | null | undefined): string[] {
  return (stored ?? '').split(/[,\s]+/).map(scope => scope.trim()).filter(Boolean);
}

/** Pure: compares recorded grants with Root's required scopes for each area. */
export function facebookGrantGroups(stored: string | null | undefined, requirements: FacebookGrantRequirements, input: { hasAdAccounts: boolean; locale?: FacebookConnectionLocale }): GrantGroupHealth[] {
  const granted = new Set(parseGrantedScopes(stored));
  const copy = facebookConnectionCopy[input.locale ?? 'en'];
  const area = (id: GroupId, required: readonly string[]): GrantGroupHealth | null => {
    if (!required.length) return null;
    const state = granted.size === 0 ? 'unknown' : required.every(scope => granted.has(scope)) ? 'granted' : 'missing';
    return { id, label: copy[id], state };
  };
  return [
    area('publishing', requirements.publishing),
    area('deleting', requirements.deleting),
    area('firstComment', requirements.firstComment),
    area('postStatus', requirements.postStatus),
    area('insights', requirements.insights),
    area('inbox', [...requirements.inboxRead, ...requirements.inboxWrite]),
    ...(input.hasAdAccounts ? [area('adsReporting', requirements.adsReporting), requirements.adsManagementEnabled ? area('adsManagement', requirements.adsManagement) : null] : []),
  ].filter((group): group is GrantGroupHealth => group !== null);
}

export async function facebookGrantHealth(input: { scopes: string | null | undefined; hasAdAccounts: boolean; locale?: FacebookConnectionLocale }): Promise<GrantGroupHealth[]> {
  const read = (key: string) => runtimeConfig(key as never) as Promise<string[]>;
  const [publishing, deleting, firstComment, postStatus, insights, inboxRead, inboxWrite, adsReporting, adsManagement, adsManagementEnabled] = await Promise.all([
    read('meta.postPublishScopes'), read('meta.postDeleteScopes'), read('meta.firstCommentScopes'), read('meta.postReadScopes'),
    read('meta.pageInsightReadScopes'), read('meta.inboxReadScopes'), read('meta.inboxWriteScopes'), read('meta.adsReadScopes'), read('meta.adsManageScopes'),
    runtimeConfig('ads.managementEnabled') as Promise<boolean>,
  ]);
  return facebookGrantGroups(input.scopes, { publishing, deleting, firstComment, postStatus, insights, inboxRead, inboxWrite, adsReporting, adsManagement, adsManagementEnabled }, input);
}
