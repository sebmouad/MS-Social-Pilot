import { configOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { publishingErrorCopy, publishingErrorCopySchema, publishingErrorText } from '../error-catalog';

/** Request-scoped catalog read. Copy availability must not replace an authorization or recovery result. */
export const loadPublishingErrorCopy = cache(async () => {
  try { return (await configOrDefault('publishing.errorCopy', publishingErrorCopySchema)); }
  catch { return publishingErrorCopy; }
});
export const loadPublishingErrorText = cache(async () => publishingErrorText(await loadPublishingErrorCopy()));
