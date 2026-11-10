'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { SidePanel } from '@/components/SidePanel';
import { useToast } from '@/components/Toast';
import { IconCopy, IconRefresh } from '@tabler/icons-react';
import { useAdsMessage, useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

type Creative = { id: string; name: string | null; status: string | null; title: string | null; body: string | null; thumbnailUrl: string | null };

/**
 * Account creatives, loaded only when the member asks: the provider read behind
 * `view=creatives` never runs on page load. Paging follows the service cursor.
 */
export function CreativesBrowser({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const t = useAdsText();
  const localize = useAdsMessage();
  const toast = useToast();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [items, setItems] = useState<Creative[] | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  async function load(cursor: string | null, append: boolean) {
    if (!accountId || busy) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ view: 'creatives', adAccountId: accountId, ...(cursor ? { after: cursor } : {}) });
      const response = await fetch(`/api/ads/management?${params}`);
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Creative[]; next?: string | null };
      if (!response.ok || !payload.items) throw new Error(payload.error || t('text248'));
      setItems(append && items ? [...items, ...payload.items] : payload.items);
      setAfter(payload.next ?? null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('text248')); }
    finally { setBusy(false); }
  }

  // Opening the tab (or choosing another account) is the request to see its creatives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(null, false); }, [accountId]);

  async function copyId(row: Creative) {
    try { await navigator.clipboard.writeText(row.id); toast.notify({ title: t('text159'), tone: 'success' }); }
    catch { toast.failed(t('text160'), () => void copyId(row), t('text161')); }
  }

  const open = items?.find(row => row.id === openId) ?? null;
  const label = (row: Creative) => row.name || row.title || t('manageCreativeUntitled');

  return <div className="ads-creatives-browser">
    <div className="ads-creatives__bar">
      {accounts.length > 1 ? <label>{t('text193')}<select value={accountId} onChange={event => { setAccountId(event.target.value); setItems(null); setAfter(null); setError(''); }} disabled={busy}>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></label> : <span className="small-note">{accounts[0]?.name}</span>}
      <Button type="button" size="sm" leading={<IconRefresh size={15} />} onClick={() => void load(null, false)} disabled={busy || !accountId}>{t('manageCreativesRefresh')}</Button>
    </div>
    {busy && items === null ? <p role="status" className="small-note">{t('text093')}</p> : null}
    {error ? <p role="alert" className="ui-error">{localize(error)}</p> : null}
    {items !== null ? items.length === 0 ? <p className="ads-creatives__empty">{t('manageCreativesEmpty')}</p> : <>
      <ul className="ads-creatives__grid" aria-label={t('manageCreativesList')}>
        {items.map(row => <li key={row.id}><button type="button" className="ads-creatives__card" onClick={() => setOpenId(row.id)}>
          {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ads-creatives__nopic" aria-hidden="true" />}
          <span className="ads-creatives__body"><strong>{label(row)}</strong>{row.body ? <span>{row.body}</span> : null}{row.status ? <span className="ui-badge">{row.status}</span> : null}</span>
        </button></li>)}
      </ul>
      {after ? <p><Button type="button" onClick={() => void load(after, true)} disabled={busy}>{t('text078')}</Button></p> : null}
    </> : null}
    <p className="small-note">{t('manageCreativesReadOnly')}</p>
    <SidePanel open={open !== null} title={open ? label(open) : ''} closeLabel={t('text091')} onClose={() => setOpenId(null)}>
      {open ? <div className="ads-creatives__detail">
        {open.thumbnailUrl ? <img src={open.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : null}
        <div>
          {open.title && open.title !== open.name ? <h3>{open.title}</h3> : null}
          {open.body ? <p>{open.body}</p> : null}
          {open.status ? <p><span className="ui-badge">{open.status}</span></p> : null}
          <details className="ads-object-manager__technical"><summary>{t('manageTechnical')}</summary>
            <p><span>{t('manageTechnicalId')}</span> <code>{open.id}</code> <Button size="sm" variant="quiet" leading={<IconCopy size={15} />} onClick={() => void copyId(open)}>{t('manageCopyId')}</Button></p>
          </details>
        </div>
      </div> : null}
    </SidePanel>
  </div>;
}
