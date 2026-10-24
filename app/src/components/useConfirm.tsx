'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

type ConfirmOptions = {
  exactConfirmation: string;
  confirmationLabel: string;
  pendingLabel: string;
  failureLabel: string;
  /** Return a safe localized error to keep the dialog and input open for retry. */
  onConfirm: () => Promise<string | null>;
};

/** Shared confirmation. Optional exact input and async action retain context on recoverable failures. */
export function useConfirm(labels: { title: string; cancel: string; confirm: string; danger?: boolean }): [(text: string, options?: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<{ text: string; options?: ConfirmOptions } | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const pending = useRef(false);
  const ask = useCallback((text: string, options?: ConfirmOptions) => new Promise<boolean>(resolve => {
    if (pending.current) { resolve(false); return; }
    resolver.current?.(false); resolver.current = resolve;
    setValue(''); setError(''); setRequest({ text, options });
  }), []);
  const answer = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setRequest(null); };
  const submit = async () => {
    if (pending.current || !request || request.options && value !== request.options.exactConfirmation) return;
    if (!request.options) { answer(true); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      const failure = await request.options.onConfirm();
      if (failure) setError(failure); else answer(true);
    } catch { setError(request.options.failureLabel); }
    finally { pending.current = false; setBusy(false); }
  };
  const dialog = <Dialog open={request !== null} title={labels.title} closeLabel={labels.cancel} busy={busy} onClose={() => { if (!pending.current) answer(false); }}
    actions={<><Button data-dialog-cancel disabled={busy} onClick={() => answer(false)}>{labels.cancel}</Button><Button disabled={busy || Boolean(request?.options && value !== request.options.exactConfirmation)} variant={labels.danger === false ? 'primary' : 'danger'} onClick={() => void submit()}>{busy ? request?.options?.pendingLabel : labels.confirm}</Button></>}>
    <p>{request?.text}</p>
    {request?.options && <label className="ui-field"><span>{request.options.confirmationLabel}: <code>{request.options.exactConfirmation}</code></span><input className="ui-input" value={value} disabled={busy} onChange={event => setValue(event.target.value)} autoComplete="off" spellCheck={false} /></label>}
    {error && <p role="alert" className="ui-error">{error}</p>}
  </Dialog>;
  return [ask, dialog];
}
