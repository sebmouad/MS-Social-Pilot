'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import type { PlatformPublicationAction, PlatformPublicationActionResult } from '@/server/platforms/host';

type Props = { providerId: string; action: PlatformPublicationAction; onReceipt?: (message: string) => void };
const validReceipt = (value: unknown, action: PlatformPublicationAction): value is PlatformPublicationActionResult => {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.actionId === action.actionId && result.subjectId === action.subjectId &&
    typeof result.operationId === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(result.operationId) &&
    ['confirmed', 'rejected', 'needs_review'].includes(String(result.state)) && typeof result.ok === 'boolean' &&
    typeof result.message === 'string' && result.message.trim().length > 0 && result.message.length <= 500 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.message) &&
    (result.state === 'confirmed' ? result.ok === true : result.ok === false);
};

export function RootPlatformPublicationAction({ providerId, action, onReceipt }: Props) {
  const router = useRouter();
  const id = useId().replace(/:/g, '');
  const metadataVersion = JSON.stringify(action);
  const previousMetadataVersion = useRef(metadataVersion);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error && !busy) errorRef.current?.focus(); }, [error, busy]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => {
    if (previousMetadataVersion.current !== metadataVersion) {
      previousMetadataVersion.current = metadataVersion;
      setReviewRequired(false);
    }
  }, [metadataVersion]);

  const dismiss = () => {
    if (busy) return;
    if (reviewRequired) {
      router.refresh();
      setNotice('Evidence refreshed. Check the current module action details before continuing.');
    }
    setOpen(false); setError(null); setConfirmation(''); setAcknowledged(false);
  };
  const submit = async () => {
    if (busy || confirmation !== action.confirmation || !acknowledged) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/root/platform-publication-evidence', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, actionId: action.actionId, subjectId: action.subjectId, confirmation, acknowledged: true }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || !validReceipt(payload, action)) {
        const result = validReceipt(payload, action) ? payload : null;
        const validationError = !response.ok && response.status < 500 && payload && typeof payload === 'object' &&
          (payload as { code?: unknown }).code === 'invalid_request' && typeof (payload as { error?: unknown }).error === 'string';
        if (response.status >= 500 || !result && !validationError || result?.state === 'needs_review') setReviewRequired(true);
        const status = result?.state === 'needs_review' || response.status >= 500
          ? 'The result could not be confirmed. Review the current platform evidence before taking further action.'
          : result?.state === 'rejected' ? result.message
            : typeof (payload as { error?: unknown } | null)?.error === 'string' ? (payload as { error: string }).error
              : 'The result could not be confirmed. Review the current platform evidence before taking further action.';
        setError(status); return;
      }
      if (payload.state !== 'confirmed' || payload.ok !== true) { if (payload.state === 'needs_review') setReviewRequired(true); setError(payload.message); return; }
      setOpen(false); setConfirmation(''); setAcknowledged(false);
      if (onReceipt) onReceipt(payload.message);
      else setNotice(payload.message);
      router.refresh();
    } catch {
      setReviewRequired(true);
      setError('The result could not be confirmed. Review the current platform evidence before taking further action.');
    } finally { setBusy(false); }
  };

  return <>
    <Button type="button" variant="danger" size="sm" disabled={reviewRequired} onClick={() => { setOpen(true); setError(null); setNotice(null); }}>{action.label}</Button>
    {!onReceipt && notice ? <p ref={noticeRef} className="root-control__notice" role="status" tabIndex={-1}>{notice}</p> : null}
    {open ? <ModalDialog className="ui-dialog" labelledBy={`root-platform-action-${id}`} describedBy={`root-platform-action-description-${id}`} onDismiss={dismiss} busy={busy}>
      <div className="ui-dialog__header"><h2 id={`root-platform-action-${id}`}>{action.label}</h2></div>
      <div className="ui-dialog__body">
        <p id={`root-platform-action-description-${id}`}>{action.description}</p>
        <label className="ui-field"><span>Type <strong>{action.confirmation}</strong> to confirm</span>
          <input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} aria-label="Exact confirmation" />
        </label>
        <label className="ui-field"><span><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} /> {action.acknowledgmentLabel}</span></label>
        {error ? <p ref={errorRef} className="ui-error" role="alert" tabIndex={-1}>{error}</p> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button type="button" data-dialog-cancel disabled={busy} onClick={dismiss}>{reviewRequired ? 'Close and review' : 'Cancel'}</Button>
        <Button type="button" variant="danger" disabled={busy || reviewRequired || confirmation !== action.confirmation || !acknowledged} onClick={() => void submit()}>{busy ? 'Working…' : action.label}</Button>
      </div>
    </ModalDialog> : null}
  </>;
}
