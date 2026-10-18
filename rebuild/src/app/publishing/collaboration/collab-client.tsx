'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import styles from './collaboration.module.css';

/** Sends one JSON request and returns the parsed body, or throws the server's safe message. Unknown outcomes say so. */
export async function send<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new Error('The request could not be confirmed. Refresh and check the current state before trying again.'); }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string' ? (parsed as { error: string }).error : 'The request could not be confirmed. Refresh and check the current state before trying again.');
  if (parsed === null) throw new Error('The response could not be read. Refresh and check the current state before trying again.');
  return parsed as T;
}

/** One in-flight action at a time with a visible result that survives list changes. */
export function useAction() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  async function run(task: () => Promise<string>) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { const text = await task(); setNotice(v => ({ error: false, text, key: (v?.key ?? 0) + 1 })); return true; }
    catch (error) { setNotice(v => ({ error: true, text: error instanceof Error ? error.message : 'The result is unknown. Refresh before retrying.', key: (v?.key ?? 0) + 1 })); return false; }
    finally { setBusy(false); inFlight.current = false; }
  }
  const banner = notice ? <RouteNotice error={notice.error} focusKey={`collab-notice:${notice.key}`}>{notice.text}</RouteNotice> : null;
  return { busy, run, banner, feedback: notice?.error ? banner : null };
}

/** Shared review dialog; typed confirmation is reserved for the consequential variants. */
export function ConfirmDialog({ open, title, description, confirmation, actionLabel, danger = false, confirmationMode = 'typed', busy, onCancel, onConfirm, children, feedback }: { open: boolean; title: string; description: string; confirmation: string; actionLabel: string; danger?: boolean; confirmationMode?: 'typed' | 'review'; busy: boolean; onCancel: () => void; onConfirm: () => void; children?: ReactNode; feedback?: ReactNode }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const close = () => { if (!busy) { setTyped(''); onCancel(); } };
  return <Dialog open={open} title={title} description={description} onClose={close} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={close}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} disabled={busy || (confirmationMode === 'typed' && typed !== confirmation)} onClick={onConfirm}>{busy ? 'Working…' : actionLabel}</Button></>}>
    {children}
    {feedback}
    {confirmationMode === 'typed' && <label className={styles.confirmLabel}>Type <code>{confirmation}</code> to confirm<input autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} /></label>}
  </Dialog>;
}
