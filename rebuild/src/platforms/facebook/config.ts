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
  /** Root-managed ceiling for an image uploaded from local storage. */
  maxImageUploadBytes: number;
  /** Root-managed MIME allowlist for binary Page photo uploads. */
  allowedImageMimeTypes: readonly string[];
  /** Root policy for signing every normal Graph request with appsecret_proof. */
  appSecretProofEnabled: boolean;
  /** Server-only app secret used to sign Graph requests when policy is enabled. */
  appSecret?: string;
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
  if (typeof config.appSecretProofEnabled !== 'boolean') throw new Error('Facebook app secret proof policy must be configured.');
  if (config.appSecret !== undefined && (typeof config.appSecret !== 'string' || !config.appSecret.trim())) throw new Error('Facebook app secret must be a non-empty string when configured.');
  if (!Number.isInteger(config.maxImageUploadBytes) || config.maxImageUploadBytes < 1 || config.maxImageUploadBytes > 25 * 1024 * 1024) throw new Error('Facebook image upload limit is out of range.');
  if (!Array.isArray(config.allowedImageMimeTypes) || !config.allowedImageMimeTypes.length || config.allowedImageMimeTypes.some(type => !['image/jpeg', 'image/png', 'image/gif'].includes(type))) throw new Error('Facebook image MIME allowlist is invalid.');
  if (base.username || base.password || oauth.username || oauth.password || oauth.search || oauth.hash) throw new Error('Facebook endpoints cannot contain credentials, query strings, or fragments.');
  return config;
}
