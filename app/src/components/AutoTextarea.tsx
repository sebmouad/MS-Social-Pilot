'use client';

import { forwardRef, useCallback, useEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Natural document growth keeps long input readable without an independent resize handle. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea({ style, onChange, value, ...props }, forwardedRef) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const element = field.current;
    if (!element || !element.getBoundingClientRect().width) return;
    element.style.height = 'auto';
    const computed = getComputedStyle(element);
    const border = parseFloat(computed.borderTopWidth || '0') + parseFloat(computed.borderBottomWidth || '0');
    const padding = parseFloat(computed.paddingTop || '0') + parseFloat(computed.paddingBottom || '0');
    element.style.height = `${element.scrollHeight + (computed.boxSizing === 'border-box' ? border : -padding)}px`;
  }, []);
  const attach = useCallback((element: HTMLTextAreaElement | null) => {
    field.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef]);
  useEffect(() => { resize(); }, [resize, value]);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    let mounted = true;
    const reset = () => queueMicrotask(() => { if (mounted) resize(); });
    form.addEventListener('reset', reset);
    return () => { mounted = false; form.removeEventListener('reset', reset); };
  }, [resize]);
  useEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.getBoundingClientRect().width;
    let frame = 0;
    // Resize on the next frame: changing height inside the callback triggers "ResizeObserver loop" errors.
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; cancelAnimationFrame(frame); frame = requestAnimationFrame(resize); }
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [resize]);
  return <textarea {...props} value={value} ref={attach} style={{ ...style, resize: 'none', overflowY: 'hidden' }} onChange={event => { resize(); onChange?.(event); }} />;
});
