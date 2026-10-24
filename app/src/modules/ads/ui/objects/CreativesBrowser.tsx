'use client';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { useToast } from '@/components/Toast';
import { IconCopy } from '@tabler/icons-react';
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

  async function copyId(row: Creative) {
    try { await navigator.clipboard.writeText(row.id); toast.notify({ title: t('text159'), tone: 'success' }); }
    catch { toast.failed(t('text160'), () => void copyId(row), t('text161')); }
  }

  return <div className="ads-creatives-browser">
    <p className="small-note">{t('manageCreativesReadOnly')}</p>
    <div className="ads-campaign-create__fields">
      <label>{t('text193')}<select value={accountId} onChange={event => { setAccountId(event.target.value); setItems(null); setAfter(null); setError(''); }} disabled={busy}>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></label>
      <Button type="button" onClick={() => void load(null, false)} disabled={busy || !accountId}>{t('adCreateLoad')}</Button>
    </div>
    {busy && items === null ? <p role="status">{t('text093')}</p> : null}
    {error ? <p role="alert" className="ui-error">{localize(error)}</p> : null}
    {items !== null ? <>
      <DataTable caption={t('manageCreativesList')} rows={items} rowKey={row => row.id} emptyMessage={t('manageCreativesEmpty')}
        rowActionsLabel={row => t('text163', { value0: row.name ?? row.id })}
        rowActions={row => [{ key: 'copy', label: t('text164'), icon: <IconCopy size={16} />, onSelect: () => void copyId(row) }]}
        columns={[
        { key: 'preview', label: t('manageCreativePreview'), render: row => row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" width={96} height={72} loading="lazy" /> : t('text094') },
        { key: 'name', label: t('text066'), render: row => <><strong>{row.name || row.title || row.id}</strong><br /><span className="small-note">{row.id}</span>
          {row.name && row.title && row.title !== row.name ? <><br /><span>{row.title}</span></> : null}
          {row.body ? <><br /><span className="small-note">{row.body}</span></> : null}</> },
        { key: 'status', label: t('manageStatus'), render: row => row.status ?? t('text094') },
      ]} />
      {after ? <p><Button type="button" onClick={() => void load(after, true)} disabled={busy}>{t('text078')}</Button></p> : null}
    </> : null}
  </div>;
}
