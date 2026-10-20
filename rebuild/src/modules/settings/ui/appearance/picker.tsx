"use client";

import { useState } from 'react';
import { THEMES, MODES } from '@/lib/themes';
import { Button } from '@/components/Button';
import styles from './appearance.module.css';
import type { AppearanceCopy } from './copy';

export function AppearancePicker({ initialTheme, initialMode, copy: t, canWrite }: { initialTheme: string; initialMode: string; copy: AppearanceCopy; canWrite: boolean }) {
  const [selected, select] = useState(initialTheme);
  const [mode, selectMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  async function save() {
    if (!canWrite || busy) return;
    setBusy(true); setNotice(''); setFailed(false);
    try {
      const response = await fetch('/api/settings/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: selected, mode, confirmation: 'UPDATE APPEARANCE' }) });
      if (!response.ok) throw new Error();
      // Reload the shared theme context using the cookies persisted by the service.
      setNotice(t.saved); window.location.reload();
    } catch { setFailed(true); setNotice(t.failed); }
    finally { setBusy(false); }
  }
  return <><div className={styles.grid} role="group" aria-label={t.group}>
    {THEMES.map(option => {
      const active = selected === option.id;
      return <button disabled={busy || !canWrite} key={option.id} type="button" className={`${styles.option}${active ? ` ${styles.selected}` : ''}`} aria-pressed={active} onClick={() => { select(option.id); setNotice(''); }}>
        <span className={styles.preview} aria-hidden="true" style={{ background: option.swatches[0] }}>
          <span className={styles.previewRail} style={{ background: option.swatches[2] }}><i style={{ background: option.swatches[1] }} /></span>
          <span className={styles.previewCard}><i style={{ background: option.swatches[2] }} /><i /><b style={{ background: option.swatches[1] }} /></span>
          <span className={styles.swatches}>{option.swatches.map(color => <i key={color} style={{ background: color }} />)}</span>
        </span>
        <span className={styles.copy}><span className={styles.name}>{t[option.id]}{active && <span className={styles.current}>{t.current}</span>}</span><span className={styles.description}>{t[`${option.id}Description`]}</span></span>
        <span className={styles.check} aria-hidden="true">{active ? '✓' : ''}</span>
      </button>;
    })}
  </div><label className="ui-field">{t.mode}<select className="ui-input" disabled={busy || !canWrite} value={mode} onChange={event => { selectMode(event.target.value); setNotice(''); }}>{MODES.map(option => <option key={option.id} value={option.id}>{t[option.id]}</option>)}</select></label>
  <Button type="button" variant="primary" disabled={busy || !canWrite} onClick={() => void save()}>{busy ? t.saving : t.save}</Button>
  {notice && <p role={failed ? 'alert' : 'status'}>{notice}</p>}</>;
}
