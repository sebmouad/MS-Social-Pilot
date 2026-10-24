import { cache } from 'react';
import { publishingMediaFormatter } from '../media-support';
import { loadComposerCopy } from './composer-copy';

export const loadPublishingMediaText = cache(async () => {
  try { return publishingMediaFormatter(await loadComposerCopy()); }
  catch { return publishingMediaFormatter(); }
});
