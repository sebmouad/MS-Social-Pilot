import { configValueOrDefault } from '@/server/config/config-or-default';
import 'server-only';
import type { PublishingActionCopy } from '../action-catalog';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';

/** One catalog read per server request; serialize through PublishingActionCopyProvider. */
export const loadPublishingActionCopy = cache(() => configValueOrDefault('publishing.actionCopy') as Promise<PublishingActionCopy>);
