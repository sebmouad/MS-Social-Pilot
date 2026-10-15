/** Facebook operational settings are supplied by the host application. */
export interface FacebookConfig {
  graphBaseUrl: string;
  oauthBaseUrl: string;
  graphVersion: string;
  requestTimeoutMs: number;
  maxPages: number;
  pageSize: number;
  /** Metric names approved for the configured app and its permissions. */
  pageInsightMetrics: readonly string[];
  adInsightFields: readonly string[];
}

export function validateFacebookConfig(config: FacebookConfig): FacebookConfig {
  const base = new URL(config.graphBaseUrl);
  const oauth = new URL(config.oauthBaseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('Facebook Graph endpoint must use HTTPS.');
  if (oauth.protocol !== 'https:' && oauth.hostname !== 'localhost') throw new Error('Facebook OAuth endpoint must use HTTPS.');
  if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('Facebook Graph version must look like vNN.N.');
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1 || config.requestTimeoutMs > 120_000) throw new Error('Facebook request timeout is out of range.');
  if (!Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 100) throw new Error('Facebook page limit is out of range.');
  if (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 100) throw new Error('Facebook page size is out of range.');
  if (!Array.isArray(config.pageInsightMetrics) || !Array.isArray(config.adInsightFields)) throw new Error('Facebook insight fields must be configured.');
  if (base.username || base.password || oauth.username || oauth.password || oauth.search || oauth.hash) throw new Error('Facebook endpoints cannot contain credentials, query strings, or fragments.');
  return config;
}
