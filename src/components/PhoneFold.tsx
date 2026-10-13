'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Secondary tools that sit open beside a screen on a wide display and fold
 * behind one button on a phone, so the screen's own content is not pushed
 * below the fold by a stack of buttons.
 */
export function PhoneFold({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    let phoneOpen = false;
    const update = () => { if (ref.current) ref.current.open = wide.matches || phoneOpen; };
    const remember = () => { if (!wide.matches && ref.current) phoneOpen = ref.current.open; };
    update();
    const element = ref.current;
    element?.addEventListener('toggle', remember);
    wide.addEventListener('change', update);
    return () => { element?.removeEventListener('toggle', remember); wide.removeEventListener('change', update); };
  }, []);

  return (
    <details ref={ref} open className="group">
      <summary className="btn-secondary w-full cursor-pointer list-none justify-center lg:hidden [&::-webkit-details-marker]:hidden">{t('moreOptions')}</summary>
      <div className="mt-2 flex flex-col gap-2 lg:mt-0">{children}</div>
    </details>
  );
}
