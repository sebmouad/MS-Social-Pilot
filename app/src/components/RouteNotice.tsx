'use client';
import { useEffect, useRef } from 'react';

/** A route-level result survives removal of the row that initiated it. */
export function RouteNotice({ children, className, error = false, focusKey }: { children: string; className?: string; error?: boolean; focusKey: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [focusKey]);
  return <p ref={ref} tabIndex={-1} className={className} role={error ? 'alert' : 'status'}>{children}</p>;
}
