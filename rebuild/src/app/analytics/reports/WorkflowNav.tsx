import styles from './workflows.module.css';
/** The manifest owns feature navigation; this wrapper carries contextual filters only. */
export function WorkflowNav({ children }: { current: string; children?: React.ReactNode }) {
  return <div className={styles.sidebar}>{children}</div>;
}
