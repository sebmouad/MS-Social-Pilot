import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { inboxCustomerCopySchema, type InboxCustomerCopy } from '../customer-copy';
/** One Root read and validation shared by all Inbox consumers in a server request. */
export const loadInboxCustomerCopy = cache(async (): Promise<InboxCustomerCopy> =>
  inboxCustomerCopySchema.parse(await runtimeConfig('inbox.customerCopy')));
