'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import styles from '@/modules/settings/ui/settings.module.css';

/** First field when the form is loaded; the cancel button until then. */
const FIRST_FOCUS = 'input, [data-dialog-cancel]';
type Form = { platform: string; confirmation: string; title: string; intro: string; submit: string; fields: Array<{ key: string; label: string; help?: string; secret: boolean; maxLength: number }> };

/**
 * Connect a platform by entering a credential (app password, bot token). All wording and fields come from the
 * platform module through the shared connection service; secrets are sent once and never kept in the page.
 */
export function CredentialConnectDialog({ platformId, platformName, locale, labels, onClose, onConnected }: {
  platformId: string; platformName: string; locale: 'en' | 'fr';
  labels: { cancel: string; connecting: string; close: string; failed: string; loading: string };
  onClose: () => void; onConnected: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/oauth/connections/${encodeURIComponent(platformId)}/credentials?locale=${locale}`, { cache: 'no-store' })
      .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok || !Array.isArray(body.fields)) throw new Error(body.error ?? labels.failed); if (!cancelled) setForm(body as Form); })
      .catch(error => { if (!cancelled) setNotice(error instanceof Error ? error.message : labels.failed); });
    return () => { cancelled = true; };
  }, [platformId, locale, labels.failed]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || sending.current) return;
    sending.current = true; setBusy(true); setNotice('');
    try {
      const response = await fetch(`/api/oauth/connections/${encodeURIComponent(platformId)}/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: values, confirmation: form.confirmation }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? labels.failed);
      // The secret leaves the form state as soon as the server has accepted it.
      setValues({}); onConnected();
    } catch (error) { setNotice(error instanceof Error ? error.message : labels.failed); }
    finally { sending.current = false; setBusy(false); }
  }

  return <ModalDialog className={styles['connection-dialog']} labelledBy="credential-dialog-title" onDismiss={onClose} busy={busy} initialFocus={FIRST_FOCUS}>
    <form onSubmit={submit} autoComplete="off">
      <header><div><p className={styles['settings-eyebrow']}>{platformName}</p><h2 id="credential-dialog-title">{form?.title ?? platformName}</h2>{form && <p>{form.intro}</p>}</div><button type="button" aria-label={labels.close} disabled={busy} onClick={onClose}>×</button></header>
      {!form && !notice && <p className={styles['settings-note']} role="status">{labels.loading}</p>}
      {form?.fields.map(field => <label key={field.key} className={styles['connection-field']}>
        <span>{field.label}</span>
        <input name={field.key} type={field.secret ? 'password' : 'text'} required maxLength={field.maxLength} autoComplete="off" autoCapitalize="none" spellCheck={false} value={values[field.key] ?? ''} disabled={busy} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} />
        {field.help && <small>{field.help}</small>}
      </label>)}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" data-dialog-cancel onClick={onClose} disabled={busy}>{labels.cancel}</button>{form && <button type="submit" className={styles['connection-primary-button']} disabled={busy}>{busy ? labels.connecting : form.submit}</button>}</footer>
    </form>
  </ModalDialog>;
}
