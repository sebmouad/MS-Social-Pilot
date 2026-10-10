import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

/**
 * A screen with nothing on it yet: what would be here, why it is empty, and
 * the one thing that fills it. Facebook's empty states, in short — an icon on
 * a grey disc, a line in bold, a line of help, the button.
 *
 * Takes its words as props, so server and client screens can both use it.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon name={icon} size={26} />
      </span>
      <p className="text-[17px] font-semibold text-slate-900">{title}</p>
      {hint && <p className="max-w-md text-sm text-slate-600">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
