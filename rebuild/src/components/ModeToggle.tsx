"use client";
import { useState } from 'react';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { MODES, useOptionalTheme } from './ThemeProvider';

const ICONS = { light: IconSun, dark: IconMoon, system: IconDeviceDesktop } as const;

/** Cycles light → dark → match device and saves through the account service. */
export function ModeToggle() {
  const theme = useOptionalTheme();
  const [failed, setFailed] = useState(false);
  if (!theme) return null;
  const { mode, setMode, busy, copy: t } = theme;
  const index = MODES.findIndex(item => item.id === mode);
  const next = MODES[(index + 1) % MODES.length];
  const Glyph = ICONS[mode];
  async function change() {
    setFailed(false);
    try { await setMode(next.id); } catch { setFailed(true); }
  }
  return <>
    <button type="button" className="shell-mode-toggle" disabled={busy} aria-busy={busy} onClick={() => void change()} aria-label={`${t.title}: ${t[mode]}. ${t.mode}: ${t[next.id]}`} title={`${t.title}: ${t[mode]}`}>
      <Glyph size={18} stroke={1.75} aria-hidden="true"/>
    </button>
    {failed && <span role="alert">{t.failed}</span>}
  </>;
}
