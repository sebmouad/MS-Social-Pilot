import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { failureFor, netJson, type NetworkConnector } from './types';

/**
 * LinkedIn: a member's own feed, and the company Pages they administer.
 *
 * Posting as yourself needs only the self-serve "Share on LinkedIn" product.
 * Company Pages need LinkedIn's Community Management API, granted after its
 * own review; until then the scopes are not asked for and only the profile
 * is offered.
 */

/** LinkedIn's versioned REST API: a month, kept for a year. */
export const LINKEDIN_VERSION = '202608';
export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'];
export const LINKEDIN_ORG_SCOPES = ['r_organization_social', 'w_organization_social', 'rw_organization_admin'];

const rest = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  'linkedin-version': LINKEDIN_VERSION,
  'x-restli-protocol-version': '2.0.0',
  ...extra,
});

export async function linkedinToken(options: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });
  const { data } = await netJson<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
    'LinkedIn',
    'https://www.linkedin.com/oauth/v2/accessToken',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
  );
  return data;
}

export async function linkedinMember(token: string) {
  const { data } = await netJson<{ sub: string; name: string; picture?: string }>('LinkedIn', 'https://api.linkedin.com/v2/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  });
  return data;
}

/** Company Pages this member administers, when the organisation scopes were granted. */
export async function linkedinOrganizations(token: string): Promise<Array<{ urn: string; name: string; logo: string | null }>> {
  const { data } = await netJson<{ elements?: Array<{ organization: string }> }>(
    'LinkedIn',
    'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100',
    { headers: rest(token) },
  ).catch(() => ({ data: { elements: [] } }));
  const orgs = [];
  for (const element of data.elements ?? []) {
    const id = element.organization.split(':').pop();
    const detail = await netJson<{ localizedName?: string }>('LinkedIn', `https://api.linkedin.com/rest/organizations/${id}`, {
      headers: rest(token),
    }).catch(() => null);
    orgs.push({ urn: element.organization, name: detail?.data.localizedName ?? `Company ${id}`, logo: null });
  }
  return orgs;
}

/**
 * LinkedIn's "little text": brackets, at-signs and the rest are markup and
 * must be escaped, and a hashtag is written as a template so it links.
 */
export function linkedinCommentary(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>*_~]/g, (char) => `\\${char}`);
  return escaped.replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, (_, space: string, tag: string) => `${space}{hashtag|\\#|${tag}}`);
}

async function uploadImage(token: string, owner: string, bytes: Buffer, mimeType: string) {
  const { data } = await netJson<{ value: { uploadUrl: string; image: string } }>(
    'LinkedIn',
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    {
      method: 'POST',
      headers: rest(token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    },
  );
  const put = await fetch(data.value.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': mimeType },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!put.ok) throw failureFor(put.status, 'the image upload was refused', 'LinkedIn');
  return data.value.image;
}

export const linkedin: NetworkConnector = {
  key: 'linkedin',
  label: 'LinkedIn',
  rules: NETWORK_RULES.linkedin,
  async publish(target, post, { credentials }) {
    const author = target.providerId;
    if (!/^urn:li:(person|organization):/.test(author)) throw new GraphError({ message: 'LinkedIn: reconnect the account.', kind: 'auth' });
    const images = post.media.filter((item) => item.kind === 'image').slice(0, 9);
    const uploaded: Array<{ id: string; altText?: string }> = [];
    for (const image of images) {
      uploaded.push({ id: await uploadImage(credentials.accessToken, author, await image.read(), image.mimeType ?? 'image/jpeg'), altText: image.altText });
    }
    const content =
      uploaded.length > 1
        ? { multiImage: { images: uploaded } }
        : uploaded.length === 1
          ? { media: uploaded[0] }
          : post.link
            ? { article: { source: post.link, title: post.linkPreview?.title ?? post.link, description: post.linkPreview?.description ?? undefined } }
            : undefined;
    const text = images.length > 0 && post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text;
    const { headers } = await netJson<unknown>('LinkedIn', 'https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: rest(credentials.accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        author,
        commentary: linkedinCommentary(text),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    const urn = headers.get('x-restli-id') ?? headers.get('x-linkedin-id') ?? '';
    return { remotePostId: urn, remoteUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : 'https://www.linkedin.com/feed/' };
  },
};
