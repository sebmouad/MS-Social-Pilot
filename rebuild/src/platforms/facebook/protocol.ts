/** Graph API wire protocol paths and field names are isolated here. */
export const FACEBOOK_CONNECTION_CALLBACK_PATH = '/api/connections/facebook/callback';
export const FACEBOOK_PROTOCOL = Object.freeze({
  pageFeedEdge: 'feed',
  accessTokenField: 'access_token',
  messageField: 'message',
  linkField: 'link',
  responseIdField: 'id',
});

/** Explicit Graph codes for invalid requests, authentication, or permissions.
 * Other provider codes remain ambiguous even when paired with an HTTP 4xx.
 */
export const FACEBOOK_DEFINITE_REJECTION_CODES: ReadonlySet<number> = new Set([100, 190, 10, ...Array.from({ length: 100 }, (_, index) => 200 + index)]);

/** Only recognized Graph codes establish definite rejection. Status-only
 * failures, including uncoded 4xx responses, remain ambiguous.
 */
export function isFacebookDefiniteRejection(status: number, code?: number, transient = false): boolean {
  return !transient && status >= 400 && status < 500 && status !== 429
    && code !== undefined && FACEBOOK_DEFINITE_REJECTION_CODES.has(code);
}

export function graphObjectUrl(config: { graphBaseUrl: string; graphVersion: string }, objectPath: string): URL {
  const base = config.graphBaseUrl.replace(/\/+$/, '');
  const version = config.graphVersion.replace(/^\/+|\/+$/g, '');
  return new URL(`${base}/${version}/${objectPath.replace(/^\/+/, '')}`);
}

export type FacebookCampaignObjective = 'OUTCOME_AWARENESS' | 'OUTCOME_ENGAGEMENT' | 'OUTCOME_LEADS' | 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' | 'OUTCOME_APP_PROMOTION';

/** Provider-specific throttling codes; generic jobs use only the retryable hint. */
const TRANSIENT_GRAPH_CODES = new Set([4, 17, 32, 613]);
export function isFacebookRetryable(status: number, code?: number, transient = false): boolean {
  return transient || status === 0 || status === 429 || status >= 500 || TRANSIENT_GRAPH_CODES.has(code ?? -1);
}
