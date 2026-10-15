/** Graph API wire protocol paths and field names are isolated here. */
export const FACEBOOK_CONNECTION_CALLBACK_PATH = '/api/connections/facebook/callback';
export const FACEBOOK_PROTOCOL = Object.freeze({
  pageFeedEdge: 'feed',
  accessTokenField: 'access_token',
  messageField: 'message',
  linkField: 'link',
  responseIdField: 'id',
});

export function graphObjectUrl(config: { graphBaseUrl: string; graphVersion: string }, objectPath: string): URL {
  const base = config.graphBaseUrl.replace(/\/+$/, '');
  const version = config.graphVersion.replace(/^\/+|\/+$/g, '');
  return new URL(`${base}/${version}/${objectPath.replace(/^\/+/, '')}`);
}
