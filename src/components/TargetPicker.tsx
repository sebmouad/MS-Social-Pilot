'use client';

export interface TargetOption {
  id: string;
  name: string;
  type: string;
  pictureUrl: string | null;
  canPublish: boolean;
  publishBlocker: string | null;
  accountName: string | null;
}

interface Props {
  targets: TargetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function TargetPicker({ targets, selected, onChange }: Props) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  const selectable = targets.filter((target) => target.canPublish);
  const allSelected = selectable.length > 0 && selectable.every((target) => selected.includes(target.id));

  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
        No Facebook pages or groups are connected yet.{' '}
        <a href="/accounts" className="font-medium text-brand-600 hover:underline">
          Connect an account
        </a>{' '}
        to start scheduling.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {selected.length} of {selectable.length} selected
        </span>
        <button
          type="button"
          className="text-xs font-medium text-brand-600 hover:underline"
          onClick={() => onChange(allSelected ? [] : selectable.map((target) => target.id))}
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {targets.map((target) => {
          const disabled = !target.canPublish;
          return (
            <label
              key={target.id}
              title={target.publishBlocker ?? undefined}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 ${
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                checked={selected.includes(target.id)}
                disabled={disabled}
                onChange={() => toggle(target.id)}
              />
              {target.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={target.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                  {target.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{target.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {target.type === 'group' ? 'Group' : 'Page'}
                  {target.accountName ? ` · ${target.accountName}` : ''}
                  {disabled && target.publishBlocker ? ` · ${target.publishBlocker}` : ''}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
