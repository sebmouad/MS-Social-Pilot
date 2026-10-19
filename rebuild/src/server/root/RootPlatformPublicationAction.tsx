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
    ['confirmed', 'attested', 'rejected', 'needs_review'].includes(String(result.state)) && typeof result.ok === 'boolean' &&
    typeof result.message === 'string' && result.message.trim().length > 0 && result.message.length <= 500 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.message) &&
    (result.state === 'confirmed' || result.state === 'attested' ? result.ok === true : result.ok === false);
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
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const fields = action.fields ?? [];

  useEffect(() => { if (error && !busy) errorRef.current?.focus(); }, [error, busy]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => {
    const firstErrorKey = fields.find(field => fieldErrors[field.key])?.key;
    if (firstErrorKey) fieldRefs.current[firstErrorKey]?.focus();
  }, [fieldErrors, fields]);
  useEffect(() => {
    if (previousMetadataVersion.current !== metadataVersion) {
      previousMetadataVersion.current = metadataVersion;
      setReviewRequired(false);
      setFieldValues({});
      setFieldErrors({});
    }
  }, [metadataVersion]);

  const announce = (message: string) => {
    if (onReceipt) onReceipt(message);
    else setNotice(message);
  };

  const dismiss = () => {
    if (busy) return;
    if (reviewRequired) {
      router.refresh();
      announce('Evidence refreshed. Check the current module action details before continuing.');
    }
    setOpen(false); setError(null); setConfirmation(''); setAcknowledged(false);
  };
  const submit = async () => {
    if (busy || confirmation !== action.confirmation || !acknowledged) return;
    const nextFieldErrors: Record<string, string> = {};
    for (const field of fields) {
      const value = fieldValues[field.key];
      if (field.kind === 'text' && field.required && (typeof value !== 'string' || !value.trim())) nextFieldErrors[field.key] = `Enter a value for ${field.label}.`;
      else if (field.kind === 'text' && typeof value === 'string' && value.length > (field.maxLength ?? 2048)) nextFieldErrors[field.key] = `Keep ${field.label} within ${field.maxLength ?? 2048} characters.`;
      else if (field.kind === 'choice' && field.required && (typeof value !== 'string' || !field.options?.some(option => option.value === value))) nextFieldErrors[field.key] = `Choose an option for ${field.label}.`;
      else if (field.kind === 'checkbox' && field.required && value !== true) nextFieldErrors[field.key] = 'Check this box to continue.';
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length) { setError(null); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/root/platform-publication-evidence', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, actionId: action.actionId, subjectId: action.subjectId, confirmation, acknowledged: true,
          ...(fields.length ? { fieldValues: Object.fromEntries(fields.flatMap(field => fieldValues[field.key] === undefined ? [] : [[field.key, fieldValues[field.key]]])) } : {}) }),
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
      if (!['confirmed', 'attested'].includes(payload.state) || payload.ok !== true) { if (payload.state === 'needs_review') setReviewRequired(true); setError(payload.message); return; }
      setOpen(false); setConfirmation(''); setAcknowledged(false);
      announce(payload.state === 'attested'
        ? `Human report recorded. The platform did not independently confirm it. ${payload.message}`
        : payload.message);
      router.refresh();
    } catch {
      setReviewRequired(true);
      setError('The result could not be confirmed. Review the current platform evidence before taking further action.');
    } finally { setBusy(false); }
  };

  const setFieldValue = (key: string, value: string | boolean) => {
    setFieldValues(current => ({ ...current, [key]: value }));
    setFieldErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setError(null);
  };
  return <>
    <Button type="button" variant={action.intent === 'inspect' ? 'secondary' : 'danger'} size="sm" disabled={reviewRequired} onClick={() => { setOpen(true); setError(null); setNotice(null); }}>{action.label}</Button>
    {!onReceipt && notice ? <p ref={noticeRef} className="root-control__notice" role="status" tabIndex={-1}>{notice}</p> : null}
    {open ? <ModalDialog className="ui-dialog root-platform-action-dialog" labelledBy={`root-platform-action-${id}`} describedBy={`root-platform-action-description-${id}`} onDismiss={dismiss} busy={busy}>
      <div className="ui-dialog__header"><h2 id={`root-platform-action-${id}`}>{action.label}</h2></div>
      <div className="ui-dialog__body">
        <p id={`root-platform-action-description-${id}`}>{action.description}</p>
        {action.context?.length ? <dl className="root-publication-evidence__context" aria-label="Resolved action context">
          {action.context.map((item, index) => <div key={`${item.label}-${index}`}>
            <dt>{item.label}</dt><dd>{item.value}</dd>
          </div>)}
        </dl> : null}
        {fields.map(field => {
          const fieldId = `root-platform-action-${id}-${field.key}`;
          const descriptionId = field.description ? `${fieldId}-description` : undefined;
          const errorId = fieldErrors[field.key] ? `${fieldId}-error` : undefined;
          const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
          const common = { 'aria-invalid': errorId ? true : undefined, 'aria-describedby': describedBy, disabled: busy };
          return <div className="ui-field" key={field.key}>
            {field.kind === 'text' ? <>
              <label htmlFor={fieldId}>{field.label}</label>
              <input id={fieldId} ref={node => { fieldRefs.current[field.key] = node; }} className="ui-input" type="text" value={typeof fieldValues[field.key] === 'string' ? fieldValues[field.key] as string : ''} maxLength={field.maxLength} required={field.required} {...common} onChange={event => setFieldValue(field.key, event.target.value)} />
            </> : field.kind === 'choice' ? <fieldset disabled={busy} aria-describedby={describedBy} aria-invalid={errorId ? true : undefined}>
              <legend>{field.label}</legend>
              {(field.options ?? []).map((option, index) => <label key={option.value} htmlFor={`${fieldId}-${index}`}>
                <input id={`${fieldId}-${index}`} ref={index === 0 ? node => { fieldRefs.current[field.key] = node; } : undefined} type="radio" name={fieldId} value={option.value} checked={fieldValues[field.key] === option.value} required={field.required} disabled={busy} onChange={() => setFieldValue(field.key, option.value)} /> {option.label}
              </label>)}
            </fieldset> : <label htmlFor={fieldId}>
              <input id={fieldId} ref={node => { fieldRefs.current[field.key] = node; }} type="checkbox" checked={fieldValues[field.key] === true} required={field.required} disabled={busy} aria-invalid={errorId ? true : undefined} aria-describedby={describedBy} onChange={event => setFieldValue(field.key, event.target.checked)} /> {field.label}
            </label>}
            {field.description ? <p id={descriptionId}>{field.description}</p> : null}
            {fieldErrors[field.key] ? <p id={errorId} className="ui-field-error" role="alert">{fieldErrors[field.key]}</p> : null}
          </div>;
        })}
        <label className="ui-field"><span>Type <strong>{action.confirmation}</strong> to confirm</span>
          <input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} aria-label="Exact confirmation" />
        </label>
        <label className="ui-field"><span><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} /> {action.acknowledgmentLabel}</span></label>
        {error ? <p ref={errorRef} className="ui-error" role="alert" tabIndex={-1}>{error}</p> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button type="button" data-dialog-cancel disabled={busy} onClick={dismiss}>{reviewRequired ? 'Close and review' : 'Cancel'}</Button>
        <Button type="button" variant={action.intent === 'inspect' ? 'secondary' : 'danger'} disabled={busy || reviewRequired || confirmation !== action.confirmation || !acknowledged} onClick={() => void submit()}>{busy ? 'Working…' : action.label}</Button>
      </div>
    </ModalDialog> : null}
  </>;
}
