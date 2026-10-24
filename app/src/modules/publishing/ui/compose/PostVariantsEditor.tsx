'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { AutoTextarea } from '@/components/AutoTextarea';
import { useConfirm } from '@/components/useConfirm';
import type { VariantListing } from '@/modules/publishing/server/post-variants';
import { catalogGroup, composerCatalogDefaults, fillComposerCopy, type ComposerCatalog } from '../../composer-catalog';

/** Manage a saved draft's per-language texts and show what each destination receives. */
export function PostVariantsEditor({ postId, locale, copyCatalog = composerCatalogDefaults }: { postId: string; locale: 'en' | 'fr'; copyCatalog?: ComposerCatalog }) {
  const t = catalogGroup(copyCatalog, 'variant', locale);
  const [listing, setListing] = useState<VariantListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [language, setLanguage] = useState('');
  const [text, setText] = useState('');
  const [confirm, dialog] = useConfirm({ title: t.title, cancel: t.cancel, confirm: t.confirm, danger: false });

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setListing(null); setFailed(false);
    fetch(`/api/publishing/post-variants?postId=${encodeURIComponent(postId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('unavailable');
        const body = (await response.json()) as VariantListing;
        if (!Array.isArray(body.variants) || !Array.isArray(body.destinations)) throw new Error('unavailable');
        if (current) setListing(body);
      })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; controller.abort(); };
  }, [postId]);

  async function mutate(action: 'add' | 'remove', phrase: string, body: Record<string, unknown>) {
    const accepted = await confirm(action === 'add' ? t.confirmAdd : t.confirmRemove, {
      exactConfirmation: phrase, confirmationLabel: t.typeConfirmation, pendingLabel: t.working, failureLabel: t.failed,
      onConfirm: async () => {
        setBusy(true); setError(''); setNotice('');
        try {
          const response = await fetch('/api/publishing/post-variants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, postId, ...body, confirmation: phrase }) });
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || result?.ok !== true) return result?.error ?? t.failed;
          const refresh = await fetch(`/api/publishing/post-variants?postId=${encodeURIComponent(postId)}`, { cache: 'no-store' });
          if (refresh.ok) setListing((await refresh.json()) as VariantListing);
          setNotice(action === 'add' ? t.added : t.removed);
          if (action === 'add') { setLanguage(''); setText(''); }
          return null;
        } catch { return t.failed; } finally { setBusy(false); }
      },
    });
    if (!accepted) setBusy(false);
  }

  if (failed) return <p role="alert">{t.error}</p>;
  if (!listing) return <p>{t.loading}</p>;
  return <div>
    <p>{t.intro}</p>
    <p role="status">{notice}</p>{error ? <p role="alert">{error}</p> : null}
    {!listing.variants.length ? <p>{t.empty}</p> : <ul>{listing.variants.map(variant => <li key={variant.locale}>
      <strong>{variant.locale}</strong>
      <p>{variant.message}</p>
      <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => mutate('remove', `REMOVE VARIANT ${postId} ${variant.locale}`, { locale: variant.locale })}>{t.remove}</Button>
    </li>)}</ul>}
    <form onSubmit={event => { event.preventDefault(); if (language.trim() && text.trim()) mutate('add', `ADD VARIANT ${postId} ${language.trim()}`, { locale: language.trim(), message: text.trim() }); }}>
      <label className="ui-field">{t.locale}<input name="variant-locale" className="ui-input" value={language} disabled={busy} onChange={event => setLanguage(event.target.value)} placeholder="fr" required /></label>
      <label className="ui-field">{t.message}<AutoTextarea name="variant-message" className="ui-input" value={text} disabled={busy} onChange={event => setText(event.target.value)} required /></label>
      <Button type="submit" size="sm" disabled={busy || !language.trim() || !text.trim()}>{busy ? t.working : t.add}</Button>
    </form>
    <h4>{t.destinations}</h4>
    {!listing.destinations.length ? <p>{t.empty}</p> : <ul>{listing.destinations.map(row => <li key={row.targetId}>
      <strong>{row.name}</strong> · {fillComposerCopy(t.effective, { locale: row.effectiveLocale ?? '—' })} · {row.variantLocale ? fillComposerCopy(t.uses, { locale: row.variantLocale }) : t.usesDefault}
    </li>)}</ul>}
    {dialog}
  </div>;
}
