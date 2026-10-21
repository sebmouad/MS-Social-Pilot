import { publishingNoticeSchema } from '../ui/posts/notices';
import { labelCopySchema } from '../ui/labels/copy';
import { templateCopySchema } from '../ui/templates/copy';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { publishingCopySchema, resolvePublishingCopy } from '../ui/kit/copy';

/** One validated copy snapshot for all Publishing consumers in a server request. */
export const loadPublishingCopy = cache(async () => {
  const catalog = publishingCopySchema.parse(await runtimeConfig('publishing.uiCopy'));
  return { catalog, copy: resolvePublishingCopy(catalog) };
});

export const loadPublishingLabelCopy = cache(async () => labelCopySchema.parse(await runtimeConfig('publishing.labelCopy')));
export const loadPublishingTemplateCopy = cache(async () => templateCopySchema.parse(await runtimeConfig('publishing.templateCopy')));

export const loadPublishingNoticeCopy = cache(async () => publishingNoticeSchema.parse(await runtimeConfig('publishing.noticeCopy')));
