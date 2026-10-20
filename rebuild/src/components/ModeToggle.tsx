"use client";
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { MODES, useOptionalTheme, type ModeId } from './ThemeProvider';

const ICONS = { light: IconSun, dark: IconMoon, system: IconDeviceDesktop } as const;

/** Cycles light → dark → match device; the choice is remembered per browser. */
export function ModeToggle() {
  const theme = useOptionalTheme();
  if (!theme) return null;
  const { mode, setMode } = theme;
  const index = MODES.findIndex(item => item.id === mode);
  const next = MODES[(index + 1) % MODES.length];
  const Glyph = ICONS[mode as ModeId] ?? IconDeviceDesktop;
  const current = MODES[index]?.name ?? 'Match device';
  return <button type="button" className="shell-mode-toggle" onClick={() => setMode(next.id)} aria-label={`Appearance: ${current}. Switch to ${next.name}`} title={`Appearance: ${current}`}>
    <Glyph size={18} stroke={1.75} aria-hidden="true"/>
  </button>;
}
