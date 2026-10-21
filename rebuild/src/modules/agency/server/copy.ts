import { AsyncLocalStorage } from 'node:async_hooks';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { uiCopy, type CustomerCopy } from '../ui/copy';
import { cache } from 'react';
import { exportCopyByLocale } from '../export-copy';
import { runtimeConfig } from '@/server/config/store';

/** React cache shares one catalog read across a rendered request. */
export const loadCustomerCopy = cache(() => runtimeConfig('agency.customerCopy'));

export const loadExportCopy = cache(async () => exportCopyByLocale(await runtimeConfig('agency.exportCopy')));

/** Service calls share one request-local snapshot, including nested authorization calls. */
const requestCopy = new AsyncLocalStorage<CustomerCopy>();
export async function withCustomerCopy<T>(operation: () => Promise<T>): Promise<T> {
  if (requestCopy.getStore()) return operation();
  const catalog = await loadCustomerCopy();
  return requestCopy.run(catalog, operation);
}
export const copyText = (text: string, ...values: Array<string | number>) => uiCopy('en', requestCopy.getStore())(text, ...values);
export const copyError = (code: OperationErrorCode, text: string) => new OperationError(code, copyText(text));
