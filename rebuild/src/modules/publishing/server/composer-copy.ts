import { configOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { composerCatalogSchema } from '../composer-catalog';

/** One validated catalog per server render/request, serialized to the client. */
export const loadComposerCopy = cache(async () => (await configOrDefault('publishing.composerCopy', composerCatalogSchema)));
