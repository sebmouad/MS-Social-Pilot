'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import styles from '@/modules/sharing/ui/links/sharing.module.css';
import { ownerText, resolveOwnerCopy } from '../owner-copy';

type Props = {
  initial: { page: { slug: string; title: string; description: string | null; avatarUrl: string | null; enabled: boolean } | null; links: Array<{ label: string; url: string; clicks: number }>; limits: { maxLinks: number }; truncated?: boolean };
  limits: { titleMax: number; descriptionMax: number; labelMax: number; urlMax: number };
  /** Phrase → text in the viewer's language (see `owner-copy.ts`); English when the host does not supply it. */
  copy?: Record<string, string>;
};

const DEFAULT_COPY = resolveOwnerCopy('en');

export function BioManager({ initial, limits, copy = DEFAULT_COPY }: Props) {
  const t = ownerText(copy);
  const linkCount = (count: number) => count === 1 ? t('{0} link', count) : t('{0} links', count);
  const clickCount = (count: number) => count === 1 ? t('{0} counted click', count) : t('{0} counted clicks', count);
  const [saved, setSaved] = useState(initial.page?.slug ?? '');
  const [slug, setSlug] = useState(initial.page?.slug ?? ''); const [title, setTitle] = useState(initial.page?.title ?? ''); const [description, setDescription] = useState(initial.page?.description ?? '');
  const [avatarUrl, setAvatarUrl] = useState(initial.page?.avatarUrl ?? ''); const [enabled, setEnabled] = useState(initial.page?.enabled ?? true);
  const [links, setLinks] = useState(initial.links.map(l => ({ ...l }))); const [consent, setConsent] = useState(false); const [deleting, setDeleting] = useState(false); const [deleteConsent, setDeleteConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [failed, setFailed] = useState(false); const [dialogError, setDialogError] = useState(''); const inFlight = useRef(false);
  const cleanSlug = slug.trim().toLowerCase(); const maxLinks = initial.limits.maxLinks;
  // The backend still requires these exact phrases; they are built here so customers never type them.
  const savePhrase = `SAVE BIO PAGE ${cleanSlug}`; const deletePhrase = `DELETE BIO PAGE ${saved}`;
  const moving = Boolean(saved) && cleanSlug !== saved;
  async function run(work: () => Promise<void>, report: (text: string) => void) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(''); setFailed(false); setDialogError('');
    try { await work(); } catch (cause) { report(cause instanceof Error ? cause.message : t('The change could not be confirmed.')); } finally { inFlight.current = false; setBusy(false); }
  }
  const pageFailure = (text: string) => { setFailed(true); setMessage(text); };
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!consent || initial.truncated === true) return; void run(async () => {
    const response = await fetch('/api/sharing/bio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: cleanSlug, title: title.trim(), description: description.trim() || null, avatarUrl: avatarUrl.trim() || null, enabled, links: links.map(l => ({ label: l.label.trim(), url: l.url.trim() })), confirmation: savePhrase }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.slug !== cleanSlug) throw new Error(typeof result.error === 'string' ? result.error : t('The bio page could not be confirmed. Refresh before trying again.'));
    setSaved(cleanSlug); setConsent(false); setMessage(enabled ? t('Saved. Public address: {0}', `${window.location.origin}/bio/${cleanSlug}`) : t('Saved. The page is switched off, so visitors cannot open it.'));
  }, pageFailure); };
  const remove = () => { if (!deleteConsent) return; void run(async () => {
    const response = await fetch('/api/sharing/bio', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: deletePhrase }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.deleted !== true) throw new Error(typeof result.error === 'string' ? result.error : t('The deletion could not be confirmed. Refresh before trying again.'));
    setSaved(''); setLinks([]); setDeleting(false); setDeleteConsent(false); setConsent(false); setMessage(t('Bio page deleted. Its address no longer opens.'));
  }, setDialogError); };
  const closeDelete = () => { setDeleting(false); setDeleteConsent(false); setDialogError(''); };
  const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);

  return <>
  <form className={styles.form} onSubmit={submit}>
    {!saved && <p className={styles.empty}>{t('No bio page yet. Fill in the details below and save to publish one.')}</p>}
    {initial.truncated && <p className={styles.error} role="alert">{t('Your key shows only part of this page’s links. Saving from here would remove the rest, so editing is paused.')}</p>}
    <div className={styles.row}>
      <label className={styles.field}><span>{t('Address')}</span><input required maxLength={40} disabled={busy} value={slug} onChange={event => { setSlug(event.target.value); setConsent(false); }} /><small>/bio/{cleanSlug || t('your-name')}: {t('letters, digits and single dashes.')}</small></label>
      <label className={styles.field}><span>{t('Title')}</span><input required maxLength={limits.titleMax} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} /></label>
    </div>
    <label className={styles.field}><span>{t('Description')}</span><textarea rows={2} maxLength={limits.descriptionMax} disabled={busy} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className={styles.field}><span>{t('Picture address (https)')}</span><input type="url" maxLength={limits.urlMax} disabled={busy} value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={enabled} onChange={event => { setEnabled(event.target.checked); setConsent(false); }} /><span>{t('Page is public')}</span></label>
    <fieldset className={styles.field}><legend>{t('Links ({0} of {1})', links.length, maxLinks)} · {clickCount(totalClicks)}</legend>
      {links.length === 0 && <p className={styles.empty}>{t('No links yet. Add the first one.')}</p>}
      {links.map((link, index) => <div key={index} className={styles.bioLink}>
        <label className={styles.field}><span>{t('Label')}</span><input required maxLength={limits.labelMax} disabled={busy} value={link.label} onChange={event => setLinks(links.map((l, i) => i === index ? { ...l, label: event.target.value } : l))} /></label>
        <label className={styles.field}><span>{t('Address')}</span><input required type="url" maxLength={limits.urlMax} disabled={busy} value={link.url} onChange={event => setLinks(links.map((l, i) => i === index ? { ...l, url: event.target.value } : l))} /><small>{clickCount(link.clicks)}</small></label>
        <div className={styles.actions}>
          <Button variant="quiet" disabled={busy || index === 0} onClick={() => setLinks(links.map((l, i, all) => i === index - 1 ? all[index]! : i === index ? all[index - 1]! : l))} aria-label={t('Move link {0} up', link.label || index + 1)}>{t('Up')}</Button>
          <Button variant="quiet" disabled={busy || index === links.length - 1} onClick={() => setLinks(links.map((l, i, all) => i === index + 1 ? all[index]! : i === index ? all[index + 1]! : l))} aria-label={t('Move link {0} down', link.label || index + 1)}>{t('Down')}</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setLinks(links.filter((_, i) => i !== index))} aria-label={t('Remove link {0}', link.label || index + 1)}>{t('Remove')}</Button>
        </div>
      </div>)}
      <Button disabled={busy || links.length >= maxLinks} onClick={() => setLinks([...links, { label: '', url: '', clicks: 0 }])}>{t('Add link')}</Button>
      <small>{t('Counts stay with a link while its label and address are unchanged. Editing either starts a new count.')}</small>
    </fieldset>
    <div className={styles.field}>
      <p>{enabled ? t('Once saved, anyone with the address /bio/{0} can open this page and see its title, description, picture and links.', cleanSlug || t('your-name')) : t('The page is switched off: visitors will not be able to open it, but your details and links are kept.')}{moving && t(' Your current address /bio/{0} stops working.', saved)}</p>
      <label className={styles.check}><input type="checkbox" disabled={busy || initial.truncated === true} checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{enabled ? t('I understand that saving replaces the current bio page and its {0} and makes the page public.', linkCount(links.length)) : t('I understand that saving replaces the current bio page and its {0}.', linkCount(links.length))}</span></label>
    </div>
    <div className={styles.actions}><Button type="submit" variant="primary" disabled={busy || initial.truncated === true || !consent}>{busy ? t('Working…') : t('Save bio page')}</Button>{saved && <Button variant="danger" disabled={busy} onClick={() => { setDeleting(true); setDeleteConsent(false); setDialogError(''); }}>{t('Delete page')}</Button>}</div>
    {message && <p className={failed ? styles.error : styles.message} role={failed ? 'alert' : 'status'}>{message}</p>}
  </form>
    <Dialog open={deleting && Boolean(saved)} title={t('Delete the bio page')} description={t('Deletes the public page and its click totals. The address stops working immediately.')} busy={busy} onClose={closeDelete}
      actions={<><Button variant="quiet" disabled={busy} onClick={closeDelete}>{t('Cancel')}</Button><Button variant="danger" disabled={busy || !deleteConsent} onClick={remove}>{busy ? t('Working…') : t('Confirm delete')}</Button></>}>
      <div className={styles.form}><label className={styles.check}><input type="checkbox" disabled={busy} checked={deleteConsent} onChange={event => setDeleteConsent(event.target.checked)} /><span>{t('This permanently deletes the bio page, its {0} and {1}. It cannot be undone and /bio/{2} stops working immediately.', linkCount(links.length), clickCount(totalClicks), saved)}</span></label>
        {dialogError && <p className={styles.error} role="alert">{dialogError}</p>}</div>
    </Dialog>
  </>;
}
