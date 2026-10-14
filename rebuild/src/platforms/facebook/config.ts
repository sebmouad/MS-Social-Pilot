/** Operational values are supplied by integration configuration, not embedded in provider logic. */
export interface FacebookConfig {
  graphBaseUrl: string;
  graphVersion: string;
  requestTimeoutMs: number;
}

export const DEFAULT_FACEBOOK_CONFIG: Readonly<FacebookConfig> = Object.freeze({
  graphBaseUrl: 'https://graph.facebook.com',
  graphVersion: 'v25.0',
  requestTimeoutMs: 30_000,
});
