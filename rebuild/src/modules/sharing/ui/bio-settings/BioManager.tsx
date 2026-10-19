'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import styles from '@/modules/sharing/ui/links/sharing.module.css';

type Props = {
  initial: { page: { slug: string; title: string; description: string | null; avatarUrl: string | null; enabled: boolean } | null; links: Array<{ label: string; url: string; clicks: number }>; limits: { maxLinks: number }; truncated?: boolean };
  limits: { titleMax: number; descriptionMax: number; labelMax: number; urlMax: number };
};

export function BioManager({ initial, limits }: Props) {
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
    try { await work(); } catch (cause) { report(cause instanceof Error ? cause.message : 'The change could not be confirmed.'); } finally { inFlight.current = false; setBusy(false); }
  }
  const pageFailure = (text: string) => { setFailed(true); setMessage(text); };
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!consent || initial.truncated === true) return; void run(async () => {
    const response = await fetch('/api/sharing/bio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: cleanSlug, title: title.trim(), description: description.trim() || null, avatarUrl: avatarUrl.trim() || null, enabled, links: links.map(l => ({ label: l.label.trim(), url: l.url.trim() })), confirmation: savePhrase }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.slug !== cleanSlug) throw new Error(typeof result.error === 'string' ? result.error : 'The bio page could not be confirmed. Refresh before trying again.');
    setSaved(cleanSlug); setConsent(false); setMessage(enabled ? `Saved. Public address: ${window.location.origin}/bio/${cleanSlug}` : 'Saved. The page is switched off, so visitors cannot open it.');
  }, pageFailure); };
  const remove = () => { if (!deleteConsent) return; void run(async () => {
    const response = await fetch('/api/sharing/bio', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: deletePhrase }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.deleted !== true) throw new Error(typeof result.error === 'string' ? result.error : 'The deletion could not be confirmed. Refresh before trying again.');
    setSaved(''); setLinks([]); setDeleting(false); setDeleteConsent(false); setConsent(false); setMessage('Bio page deleted. Its address no longer opens.');
  }, setDialogError); };
  const closeDelete = () => { setDeleting(false); setDeleteConsent(false); setDialogError(''); };
  const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);

  return <>
  <form className={styles.form} onSubmit={submit}>
    {!saved && <p className={styles.empty}>No bio page yet. Fill in the details below and save to publish one.</p>}
    {initial.truncated && <p className={styles.error} role="alert">Your key shows only part of this page's links. Saving from here would remove the rest, so editing is paused.</p>}
    <div className={styles.row}>
      <label className={styles.field}><span>Address</span><input required maxLength={40} disabled={busy} value={slug} onChange={event => { setSlug(event.target.value); setConsent(false); }} /><small>/bio/{cleanSlug || 'your-name'}: letters, digits and single dashes.</small></label>
      <label className={styles.field}><span>Title</span><input required maxLength={limits.titleMax} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} /></label>
    </div>
    <label className={styles.field}><span>Description</span><textarea rows={2} maxLength={limits.descriptionMax} disabled={busy} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className={styles.field}><span>Picture address (https)</span><input type="url" maxLength={limits.urlMax} disabled={busy} value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={enabled} onChange={event => { setEnabled(event.target.checked); setConsent(false); }} /><span>Page is public</span></label>
    <fieldset className={styles.field}><legend>Links ({links.length} of {maxLinks}) · {totalClicks} counted {totalClicks === 1 ? 'click' : 'clicks'}</legend>
      {links.length === 0 && <p className={styles.empty}>No links yet. Add the first one.</p>}
      {links.map((link, index) => <div key={index} className={styles.bioLink}>
        <label className={styles.field}><span>Label</span><input required maxLength={limits.labelMax} disabled={busy} value={link.label} onChange={event => setLinks(links.map((l, i) => i === index ? { ...l, label: event.target.value } : l))} /></label>
        <label className={styles.field}><span>Address</span><input required type="url" maxLength={limits.urlMax} disabled={busy} value={link.url} onChange={event => setLinks(links.map((l, i) => i === index ? { ...l, url: event.target.value } : l))} /><small>{link.clicks} counted {link.clicks === 1 ? 'click' : 'clicks'}</small></label>
        <div className={styles.actions}>
          <Button variant="quiet" disabled={busy || index === 0} onClick={() => setLinks(links.map((l, i, all) => i === index - 1 ? all[index]! : i === index ? all[index - 1]! : l))} aria-label={`Move link ${link.label || index + 1} up`}>Up</Button>
          <Button variant="quiet" disabled={busy || index === links.length - 1} onClick={() => setLinks(links.map((l, i, all) => i === index + 1 ? all[index]! : i === index ? all[index + 1]! : l))} aria-label={`Move link ${link.label || index + 1} down`}>Down</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setLinks(links.filter((_, i) => i !== index))} aria-label={`Remove link ${link.label || index + 1}`}>Remove</Button>
        </div>
      </div>)}
      <Button disabled={busy || links.length >= maxLinks} onClick={() => setLinks([...links, { label: '', url: '', clicks: 0 }])}>Add link</Button>
      <small>Counts stay with a link while its label and address are unchanged. Editing either starts a new count.</small>
    </fieldset>
    <div className={styles.field}>
      <p>{enabled ? `Once saved, anyone with the address /bio/${cleanSlug || 'your-name'} can open this page and see its title, description, picture and links.` : 'The page is switched off: visitors will not be able to open it, but your details and links are kept.'}{moving && ` Your current address /bio/${saved} stops working.`}</p>
      <label className={styles.check}><input type="checkbox" disabled={busy || initial.truncated === true} checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I understand that saving replaces the current bio page and its {links.length === 1 ? 'link' : `${links.length} links`}{enabled ? ' and makes the page public' : ''}.</span></label>
    </div>
    <div className={styles.actions}><Button type="submit" variant="primary" disabled={busy || initial.truncated === true || !consent}>{busy ? 'Working…' : 'Save bio page'}</Button>{saved && <Button variant="danger" disabled={busy} onClick={() => { setDeleting(true); setDeleteConsent(false); setDialogError(''); }}>Delete page</Button>}</div>
    {message && <p className={failed ? styles.error : styles.message} role={failed ? 'alert' : 'status'}>{message}</p>}
  </form>
    <Dialog open={deleting && Boolean(saved)} title="Delete the bio page" description="Deletes the public page and its click totals. The address stops working immediately." busy={busy} onClose={closeDelete}
      actions={<><Button variant="quiet" disabled={busy} onClick={closeDelete}>Cancel</Button><Button variant="danger" disabled={busy || !deleteConsent} onClick={remove}>{busy ? 'Working…' : 'Confirm delete'}</Button></>}>
      <div className={styles.form}><label className={styles.check}><input type="checkbox" disabled={busy} checked={deleteConsent} onChange={event => setDeleteConsent(event.target.checked)} /><span>This permanently deletes the bio page, its {links.length === 1 ? '1 link' : `${links.length} links`} and {totalClicks} counted {totalClicks === 1 ? 'click' : 'clicks'}. It cannot be undone and /bio/{saved} stops working immediately.</span></label>
        {dialogError && <p className={styles.error} role="alert">{dialogError}</p>}</div>
    </Dialog>
  </>;
}
