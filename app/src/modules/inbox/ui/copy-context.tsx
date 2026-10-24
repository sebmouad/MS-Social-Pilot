'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { inboxCustomerCopy, resolveInboxCatalog, type InboxCustomerCopy, inboxSourceCatalogs } from '../customer-copy';
const CopyContext = createContext<InboxCustomerCopy>(inboxCustomerCopy);
export function InboxCopyProvider({ catalog, children }: { catalog: InboxCustomerCopy; children: ReactNode }) {
  return <CopyContext.Provider value={catalog}>{children}</CopyContext.Provider>;
}
export function useInboxCatalog<K extends keyof typeof inboxSourceCatalogs>(name: K) {
  return resolveInboxCatalog(name, useContext(CopyContext));
}
