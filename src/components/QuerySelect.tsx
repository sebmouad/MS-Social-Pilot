'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * A select that rewrites one query parameter and keeps the rest.
 *
 * Filters live in the URL so a filtered screen can be linked to, reloaded or
 * bookmarked; this is the control for one of them.
 */
export function QuerySelect({
  param,
  value,
  options,
  label,
}: {
  param: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set(param, event.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
