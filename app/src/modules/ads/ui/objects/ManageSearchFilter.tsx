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
          {parentLabel}
          <input type="search" name="parentId" value={parentId} maxLength={maxParentCharacters} onChange={event => setParentId(event.target.value)} />
        </label>
      ) : null}
    </form>
  );
}
