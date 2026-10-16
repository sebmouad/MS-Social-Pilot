'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The shell owns one contextual tools surface on desktop and in its mobile drawer. */
export const SidebarDockContext = createContext<HTMLElement | null>(null);

/** Route-local controls can share the shell sidebar without a third content menu. */
export function SidebarDock({ children }: { children: ReactNode }) {
  const target = useContext(SidebarDockContext);
  return target ? createPortal(children, target) : null;
}
