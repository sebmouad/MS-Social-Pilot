import type { ReactNode } from 'react';
import type { FeatureId } from '@/lib/product';
import styles from './settings.module.css';

export { styles };

export function SettingsPage({ active, title, description, children }: {
  active: FeatureId;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <div className={styles['settings-page']}>
    <header className={styles['settings-heading']}>
      <div><p className={styles['settings-eyebrow']}>Workspace settings</p><h1>{title}</h1><p>{description}</p></div>
    </header>
    {children}
  </div>;
}

export function SettingsPanel({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div>{children}</section>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warning' | 'neutral' }) {
  return <span className={`${styles['settings-status']} ${styles[`settings-status--${tone}`]}`}><span aria-hidden="true" className={styles['settings-status__dot']} />{children}</span>;
}
