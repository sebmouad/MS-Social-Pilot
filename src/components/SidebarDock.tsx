'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The element in the area menu that a screen's filters move into. */
export const SIDEBAR_DOCK_ID = 'shell-filters';

const DockedContext = createContext(false);

/** True inside the area menu: cards there drop their own frame. */
export function useDocked(): boolean {
  return useContext(DockedContext);
}

/**
 * A screen's channels and filters, shown in the left menu beside the screen's
 * links on a laptop, so there are only two menus on the left. On a phone and
 * before the page is interactive they stay where the screen put them.
 */
export function SidebarDock({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const update = () => setTarget(wide.matches ? document.getElementById(SIDEBAR_DOCK_ID) : null);
    update();
    wide.addEventListener('change', update);
    return () => wide.removeEventListener('change', update);
  }, []);

  if (target) return createPortal(<DockedContext.Provider value>{children}</DockedContext.Provider>, target);
  return <>{children}</>;
}
