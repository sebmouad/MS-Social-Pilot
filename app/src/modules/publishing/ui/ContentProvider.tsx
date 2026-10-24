'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy, type ContentCopy, type ContentPolicy } from './content-copy';

type Value = { copy: ContentCopy; policy: ContentPolicy; locale: 'en' | 'fr' };
const Context = createContext<Value>({ copy: resolveContentCopy(contentCopyDefaults as never, 'en'), policy: contentPolicyDefaults, locale: 'en' });

/** Hands the Root-managed Create/Content copy and behaviour policy to client screens (see `loadContent`). */
export function ContentProvider({ copy, policy, locale, children }: Value & { children?: ReactNode }) {
  const value = useMemo(() => ({ copy, policy, locale }), [copy, policy, locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useContent = () => useContext(Context);
