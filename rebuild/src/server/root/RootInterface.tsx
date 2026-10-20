'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { ROOT_INTERFACE_COPY, type RootInterfaceCopy } from '@/lib/config/root-interface-copy';

const RootInterfaceContext = createContext<RootInterfaceCopy>(ROOT_INTERFACE_COPY.en);
export function RootInterfaceProvider({ copy, children }: { copy: RootInterfaceCopy; children: ReactNode }) {
  return <RootInterfaceContext.Provider value={copy}>{children}</RootInterfaceContext.Provider>;
}
export function useRootInterface() { return useContext(RootInterfaceContext); }
