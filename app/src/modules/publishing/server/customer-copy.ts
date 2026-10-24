import { configOrDefault } from '@/server/config/config-or-default';
import { publishingNoticeSchema } from '../ui/posts/notices';
import { labelCopySchema } from '../ui/labels/copy';
import { templateCopySchema } from '../ui/templates/copy';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { publishingCopySchema, resolvePublishingCopy } from '../ui/kit/copy';

/** One validated copy snapshot for all Publishing consumers in a server request. */
export const loadPublishingCopy = cache(async () => {
  const catalog = (await configOrDefault('publishing.uiCopy', publishingCopySchema));
  return { catalog, copy: resolvePublishingCopy(catalog) };
});

export const loadPublishingLabelCopy = cache(async () => (await configOrDefault('publishing.labelCopy', labelCopySchema)));
export const loadPublishingTemplateCopy = cache(async () => (await configOrDefault('publishing.templateCopy', templateCopySchema)));

export const loadPublishingNoticeCopy = cache(async () => (await configOrDefault('publishing.noticeCopy', publishingNoticeSchema)));
