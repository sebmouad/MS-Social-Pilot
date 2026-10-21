"use client";

import { useRef, useState } from 'react';
import { THEMES, MODES, type ThemeId, type ModeId } from '@/lib/themes';
import { useTheme } from '@/components/ThemeProvider';
import { Button, RadioCards, SegmentedControl, useToast } from '@/components';
import styles from './appearance.module.css';
import type { AppearanceCopy } from './copy';

export function AppearancePicker({ initialTheme, initialMode, copy: t, canWrite }: { initialTheme: string; initialMode: string; copy: AppearanceCopy; canWrite: boolean }) {
  const { saveAppearance, previewAppearance, busy: appearanceBusy } = useTheme();
  const toast = useToast();
  const [selected, select] = useState(initialTheme);
  const [mode, selectMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<() => void>(() => {});
  const retryLabel = t.save;
  async function save() {
    if (!canWrite || inFlight.current || appearanceBusy) return;
    inFlight.current = true; setBusy(true);
    try {
      await saveAppearance({ theme: selected as ThemeId, mode: mode as ModeId });
      toast.notify({ title: t.saved });
    } catch { toast.failed(t.failed, () => retry.current(), retryLabel); }
    finally { inFlight.current = false; setBusy(false); }
  }
  retry.current = () => void save();
  return <>
    <RadioCards legend={t.group} value={selected} onChange={value => { select(value); previewAppearance({ theme: value as ThemeId }); }} options={THEMES.map(option => ({
      value: option.id, label: t[option.id], description: t[`${option.id}Description`], disabled: busy || appearanceBusy || !canWrite,
      icon: <span className={styles.preview} style={{ background: option.swatches[0] }}><span className={styles.swatches}>{option.swatches.map(color => <i key={color} style={{ background: color }} />)}</span></span>,
    }))} />
    <SegmentedControl legend={t.mode} value={mode} onChange={value => { selectMode(value); previewAppearance({ mode: value as ModeId }); }} options={MODES.map(option => ({ value: option.id, label: t[option.id], disabled: busy || appearanceBusy || !canWrite }))} />
    <Button type="button" variant="primary" busy={busy} disabled={busy || appearanceBusy || !canWrite} onClick={() => void save()}>{busy ? t.saving : t.save}</Button>
  </>;
}
