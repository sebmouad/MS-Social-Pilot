const GENERIC = 'The post could not be saved. Check the details and try again.';

/**
 * Message safe to show an author. Lifecycle errors are written for people, so
 * they pass through; anything that looks like a database or runtime failure is
 * replaced so internals are never shown.
 */
export function composeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC;
  const message = error.message.trim();
  if (!message || message.length > 240 || /prisma|invocation|ECONN|ETIMEDOUT|SQL|\bat\s+\S+\s+\(|undefined|\bnull\b|stack/i.test(message)) return GENERIC;
  return message;
}
