'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import ui from './integrations.module.css';

type Strings = { secretHidden: string; show: string; hide: string; copy: string; copied: string; copyFailed: string; savedIt: string };

/** A credential shown on request. It is masked by default and cleared from memory by the caller when the person is done. */
export function SecretReveal({ label, value, notice, onDone, strings }: { label: string; value: string; notice: string; onDone: () => void; strings: Strings }) {
  const [visible, setVisible] = useState(false);
  const [copy, setCopy] = useState('');
  async function copyValue() {
    try { await navigator.clipboard.writeText(value); setCopy(strings.copied); } catch { setCopy(strings.copyFailed); }
  }
  return <div className={ui.secret} role="group" aria-label={label}>
    <strong>{label}</strong>
    <code>{visible ? value : strings.secretHidden}</code>
    <p className={ui.notice}>{notice}</p>
    <div className={ui['row-actions']}>
      <Button size="sm" aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? strings.hide : strings.show}</Button>
      <Button size="sm" onClick={() => void copyValue()}>{strings.copy}</Button>
      <Button size="sm" onClick={onDone}>{strings.savedIt}</Button>
    </div>
    <span role="status">{copy}</span>
  </div>;
}
