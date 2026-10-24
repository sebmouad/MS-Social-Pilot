/** Provider-neutral failure hints. Adapters classify their own protocol errors;
 * shared orchestration must never interpret a provider code or message. */
export class PlatformApiError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'PlatformApiError';
  }
}
