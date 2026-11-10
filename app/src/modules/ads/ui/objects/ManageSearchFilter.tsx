'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ManageSearchFilter({
  ariaLabel,
  searchLabel,
  parentLabel,
  initialQuery,
  initialParentId,
  maxFilterCharacters,
  maxParentCharacters,
  showParent,
  hiddenParams,
  parentOptions,
  parentPickLabel,
  allLabel,
}: {
  ariaLabel: string;
  searchLabel: string;
  parentLabel: string;
  initialQuery: string;
  initialParentId: string;
  maxFilterCharacters: number;
  maxParentCharacters: number;
  showParent: boolean;
  hiddenParams: Record<string, string | undefined>;
  /** Parents by name: the filter becomes a picker instead of a box for a numeric ID. */
  parentOptions?: Array<{ id: string; name: string }>;
  parentPickLabel?: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [parentId, setParentId] = useState(initialParentId);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => { setParentId(initialParentId); }, [initialParentId]);

  useEffect(() => {
    if (query === initialQuery && parentId === initialParentId) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(hiddenParams)) {
        if (value) next.set(key, value);
      }
      if (query.trim()) next.set('q', query.trim());
      if (showParent && parentId.trim()) next.set('parentId', parentId.trim());
      const qs = next.toString();
      router.replace(`/ads/manage${qs ? `?${qs}` : ''}`);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, parentId, initialQuery, initialParentId, hiddenParams, showParent, router]);

  return (
    <form
      noValidate
      method="get"
      action="/ads/manage"
      className="ads-extra-filters"
      aria-label={ariaLabel}
      onSubmit={event => {
        event.preventDefault();
        const next = new URLSearchParams();
        for (const [key, value] of Object.entries(hiddenParams)) {
          if (value) next.set(key, value);
        }
        if (query.trim()) next.set('q', query.trim());
        if (showParent && parentId.trim()) next.set('parentId', parentId.trim());
        const qs = next.toString();
        router.replace(`/ads/manage${qs ? `?${qs}` : ''}`);
      }}
    >
      {Object.entries(hiddenParams).map(([key, value]) => value ? <input key={key} type="hidden" name={key} value={value} /> : null)}
      <label>
        {searchLabel}
        <input type="search" name="q" value={query} maxLength={maxFilterCharacters} onChange={event => setQuery(event.target.value)} />
      </label>
      {showParent ? (
        <label>
          {parentOptions ? parentPickLabel ?? parentLabel : parentLabel}
          {parentOptions
            ? <select name="parentId" value={parentId} onChange={event => setParentId(event.target.value)}><option value="">{allLabel ?? ''}</option>{parentId && !parentOptions.some(option => option.id === parentId) ? <option value={parentId}>{parentId}</option> : null}{parentOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
            : <input type="search" name="parentId" value={parentId} maxLength={maxParentCharacters} onChange={event => setParentId(event.target.value)} />}
        </label>
      ) : null}
    </form>
  );
}
