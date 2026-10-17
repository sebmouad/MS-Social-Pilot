import { enabledSocialAccountWhere } from './registry';

/** Selected resources may show retained history after token expiry, but not
 * after disconnection/revocation, across tenants, or from disabled modules. */
export async function selectedResourceConnectionWhere(workspaceId: string, allowedProviders?: readonly string[]) {
  return { workspaceId, invalidatedAt: null, ...await enabledSocialAccountWhere(allowedProviders) };
}
