import type { ReactNode } from 'react';

/**
 * Says what is missing, what will fill it, and offers one next step.
 * `action` is a single link or button; do not pass several.
 */
export function EmptyState({ title, children, action, icon }: { title: string; children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <div className="ui-empty" role="status">
    {icon ? <span className="ui-empty__icon" aria-hidden="true">{icon}</span> : null}
    <h2>{title}</h2>
    <p>{children}</p>
    {action}
  </div>;
}
