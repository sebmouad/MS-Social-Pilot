'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PostMedia } from '@/lib/json';
import { requestJson } from '@/lib/client-request';
import { Dialog } from './Dialog';

export interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  /** Adds only newly chosen, authenticated workspace assets. */
  onSelect: (media: PostMedia[]) => void;
  selectedIds?: string[];
}
interface LibraryAsset extends PostMedia { filename: string }

/** The API scopes assets to the current authenticated workspace. No browser persistence. */
export function MediaPicker({ open, onClose, onSelect, selectedIds = [] }: MediaPickerProps) {
  const t = useTranslations('media');
  const common = useTranslations('common');
  const [files, setFiles] = useState<LibraryAsset[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setChosen([]); setFiles([]); setSearch('');
    void requestJson<{ media: LibraryAsset[] }>('/api/media', { cache: 'no-store' }).then(result => {
      if (!active) return;
      if (result.ok && Array.isArray(result.data?.media)) setFiles(result.data.media.filter(file => file.id && file.url && (file.kind === 'image' || file.kind === 'video')));
      else setError(!result.ok && result.error ? result.error : common('genericError'));
      setLoading(false);
    });
    return () => { active = false; };
  }, [open, attempt, common]);
  const added = files.filter(file => chosen.includes(file.id) && !selectedIds.includes(file.id));
  return <Dialog open={open} onClose={onClose} title={t('pickerTitle')} closeLabel={common('close')} footer={<button type="button" className="btn-primary" disabled={loading || added.length === 0} onClick={() => { onSelect(added.map(({ id, kind, url, storageKey, mimeType }) => ({ id, kind, url, storageKey, mimeType }))); onClose(); }}>{t('pickerAdd', { count: added.length })}</button>}>
    {loading && <p role="status">{common('working')}</p>}
    {error && <div><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className="btn-secondary" onClick={() => setAttempt(value => value + 1)}>{t('pickerRetry')}</button></div>}
    {!loading && !error && <>
      <input className="input mb-3" aria-label={t('pickerSearch')} placeholder={t('pickerSearch')} value={search} onChange={event => setSearch(event.target.value)} />
      <ul className="grid grid-cols-2 gap-2">{files.filter(file => file.filename.toLowerCase().includes(search.toLowerCase())).map(file => <li key={file.id}><label className="card flex cursor-pointer flex-col gap-2 p-2">
        {file.kind === 'image' ? <img src={file.url} alt="" className="h-24 w-full rounded object-cover" /> : <video src={file.url} preload="metadata" className="h-24 w-full rounded" />}
        <span className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(file.id) || chosen.includes(file.id)} disabled={selectedIds.includes(file.id)} onChange={event => setChosen(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))} /><span className="truncate">{file.filename}</span></span>
      </label></li>)}</ul>
      {files.length === 0 && <p className="hint">{t('empty')}</p>}
      {files.length >= 100 && <p className="hint mt-2">{t('pickerLimit')}</p>}
    </>}
  </Dialog>;
}
