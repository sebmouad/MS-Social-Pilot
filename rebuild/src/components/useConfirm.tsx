'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * Promise-based confirmation in the shared Dialog, replacing native `window.confirm`.
 * `const [confirm, dialog] = useConfirm(labels)`; render `dialog`, then `if (!(await confirm('…'))) return;`.
 * Cancel has initial focus; dismissing counts as cancel.
 */
export function useConfirm(labels: { title: string; cancel: string; confirm: string; danger?: boolean }): [(text: string) => Promise<boolean>, ReactNode] {
  const [text, setText] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback((value: string) => new Promise<boolean>(resolve => { resolver.current?.(false); resolver.current = resolve; setText(value); }), []);
  const answer = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setText(null); };
  const dialog = <Dialog open={text !== null} title={labels.title} onClose={() => answer(false)}
    actions={<><Button data-dialog-cancel onClick={() => answer(false)}>{labels.cancel}</Button><Button variant={labels.danger === false ? 'primary' : 'danger'} onClick={() => answer(true)}>{labels.confirm}</Button></>}>
    <p>{text}</p>
  </Dialog>;
  return [ask, dialog];
}
