"use client";

import { useRef, useState } from 'react';
import { THEMES, MODES, type ThemeId, type ModeId } from '@/lib/themes';
import { useTheme } from '@/components/ThemeProvider';
import { Button, RadioCards, SegmentedControl, useToast } from '@/components';
import styles from './appearance.module.css';
import type { AppearanceCopy } from './copy';

export function AppearancePicker({ initialTheme, initialMode, copy: t, canWrite }: { initialTheme: string; initialMode: string; copy: AppearanceCopy; canWrite: boolean }) {
  const { setTheme, setMode } = useTheme();
  const toast = useToast();
  const [selected, select] = useState(initialTheme);
  const [mode, selectMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<() => void>(() => {});
  const retryLabel = t.save;
  async function save() {
    if (!canWrite || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/settings/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: selected, mode, confirmation: 'UPDATE APPEARANCE' }) });
      if (!response.ok) throw new Error();
      setTheme(selected as ThemeId); setMode(mode as ModeId);
      toast.notify({ title: t.saved });
    } catch { toast.failed(t.failed, () => retry.current(), retryLabel); }
    finally { inFlight.current = false; setBusy(false); }
  }
  retry.current = () => void save();
  return <>
    <RadioCards legend={t.group} value={selected} onChange={value => { select(value); setTheme(value as ThemeId); }} options={THEMES.map(option => ({
      value: option.id, label: t[option.id], description: t[`${option.id}Description`], disabled: busy || !canWrite,
      icon: <span className={styles.preview} style={{ background: option.swatches[0] }}><span className={styles.swatches}>{option.swatches.map(color => <i key={color} style={{ background: color }} />)}</span></span>,
    }))} />
    <SegmentedControl legend={t.mode} value={mode} onChange={value => { selectMode(value); setMode(value as ModeId); }} options={MODES.map(option => ({ value: option.id, label: t[option.id], disabled: busy || !canWrite }))} />
    <Button type="button" variant="primary" busy={busy} disabled={busy || !canWrite} onClick={() => void save()}>{busy ? t.saving : t.save}</Button>
  </>;
}
