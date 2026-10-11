'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';

export interface ConfirmOptions {
  /** The question, as the dialog's title: "Cancel this post?" */
  title: string;
  /** What will happen, when the title alone does not say. */
  body?: string;
  /** The action, on its button: "Cancel post", "Delete". Defaults to "Continue". */
  confirmLabel?: string;
  /** Red button: it deletes, removes or cannot be undone. */
  danger?: boolean;
  /** The way out, when "Cancel" would be ambiguous: "Keep post" beside "Cancel post". */
  cancelLabel?: string;
}

type Ask = (options: ConfirmOptions | string) => Promise<boolean>;

/**
 * A long question reads as a headline and its consequences: "Cancel this
 * post?" on top, "Anything already scheduled on Facebook is removed." under
 * it — rather than one sentence cut off in the title bar.
 */
export function splitQuestion(options: ConfirmOptions): ConfirmOptions {
  if (options.body || options.title.length <= 60) return options;
  const match = /^(.{8,}?[?.!])\s+(.+)$/s.exec(options.title);
  return match ? { ...options, title: match[1]!, body: match[2]! } : options;
}

const ConfirmContext = createContext<Ask | null>(null);

/**
 * One confirmation dialog for the whole app, in the app's own look, in place
 * of the browser's `confirm()` — which cannot be styled, says the site's
 * address instead of what is at stake, and freezes the page while it is open.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [current, setCurrent] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((options) => {
    resolver.current?.(false);
    setCurrent(splitQuestion(typeof options === 'string' ? { title: options } : options));
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setCurrent(null);
  }, []);
  const cancel = useCallback(() => finish(false), [finish]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        open={current !== null}
        title={current?.title ?? ''}
        onClose={cancel}
        closeLabel={t('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={cancel}>
              {current?.cancelLabel ?? t('cancel')}
            </button>
            <button
              type="button"
              data-confirm
              className={`btn-primary ${current?.danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : ''}`}
              onClick={() => finish(true)}
            >
              {current?.confirmLabel ?? t('continue')}
            </button>
          </>
        }
      >
        {current?.body ? (
          <p className="text-[15px] leading-relaxed text-slate-700">{current.body}</p>
        ) : (
          <p className="text-sm text-slate-500">{t('confirmNoUndo')}</p>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (!(await confirm({ title }))) return;` */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  // Outside the provider (a test, a public page): the browser's own, so nothing breaks.
  return ask ?? (async (options) => window.confirm(typeof options === 'string' ? options : options.title));
}
