'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { WEB_APP_ROUTES } from './documents';
export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const WebAppContext = createContext<{ prompt: InstallPrompt | null; installed: boolean; clearPrompt: () => void }>({ prompt: null, installed: false, clearPrompt: () => {} });
export const useWebApp = () => useContext(WebAppContext);
/** Capture the browser event once in the persistent shell so route changes cannot lose it. */
export function WebAppProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const finished = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', finished);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register(WEB_APP_ROUTES.worker, { scope: '/', updateViaCache: 'none' }).catch(() => {
        // Browser or network policy may refuse registration; ordinary navigation stays usable.
      });
    }
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', finished); };
  }, []);
  return <WebAppContext.Provider value={{ prompt, installed, clearPrompt: () => setPrompt(null) }}>{children}</WebAppContext.Provider>;
}
