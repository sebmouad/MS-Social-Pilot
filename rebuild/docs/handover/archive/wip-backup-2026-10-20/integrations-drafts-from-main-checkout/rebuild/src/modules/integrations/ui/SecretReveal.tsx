'use client';

import { useState } from 'react';
import ui from './integrations.module.css';

/** A credential shown exactly once. It is masked by default; the caller clears it when the person is done. */
export function SecretReveal({ label, value, notice, onDone }: { label: string; value: string; notice: string; onDone: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copy, setCopy] = useState('');
  async function copyValue() {
    try { await navigator.clipboard.writeText(value); setCopy('Copied to the clipboard.'); } catch { setCopy('Could not copy. Show the value and copy it by hand.'); }
  }
  return <div className={ui.secret} role="group" aria-label={label}>
    <strong>{label}</strong>
    <code>{visible ? value : '•'.repeat(32)}</code>
    <p className={ui.notice}>{notice}</p>
    <div className={ui['row-actions']}>
      <button type="button" aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? 'Hide' : 'Show'}</button>
      <button type="button" onClick={() => void copyValue()}>Copy</button>
      <button type="button" onClick={onDone}>I have saved it</button>
    </div>
    <span role="status">{copy}</span>
  </div>;
}
