"use client";

import { THEMES, useTheme, type ThemeId } from '@/components/ThemeProvider';
import styles from './appearance.module.css';

export function AppearancePicker() {
  const { theme: selected, setTheme } = useTheme();
  return <div className={styles.grid} role="group" aria-label="Choose a workspace theme">
    {THEMES.map(option => {
      const active = selected === option.id;
      return <button key={option.id} type="button" className={`${styles.option}${active ? ` ${styles.selected}` : ''}`} aria-pressed={active} onClick={() => setTheme(option.id as ThemeId)}>
        <span className={styles.preview} aria-hidden="true" style={{ background: option.swatches[0] }}>
          <span className={styles.previewRail} style={{ background: option.swatches[2] }}><i style={{ background: option.swatches[1] }} /></span>
          <span className={styles.previewCard}><i style={{ background: option.swatches[2] }} /><i /><b style={{ background: option.swatches[1] }} /></span>
          <span className={styles.swatches}>{option.swatches.map(color => <i key={color} style={{ background: color }} />)}</span>
        </span>
        <span className={styles.copy}><span className={styles.name}>{option.name}{active && <span className={styles.current}>Current</span>}</span><span className={styles.description}>{option.description}</span></span>
        <span className={styles.check} aria-hidden="true">{active ? '✓' : ''}</span>
      </button>;
    })}
  </div>;
}
