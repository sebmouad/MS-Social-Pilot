'use client';
import { useState } from 'react';
import { useInsightsParam } from '../insights/InsightsFilterRow';

/** Metric search inside the Explore filter button; applies on Enter or when the field loses focus, so typing never reloads the page. */
export function ExploreSearchField({ label, placeholder, maxLength }: { label: string; placeholder: string; maxLength?: number }) {
  const [saved, save] = useInsightsParam('search');
  const [draft, setDraft] = useState(saved);
  const apply = () => { if (draft.trim() !== saved) save(draft.trim()); };
  return <label>{label}
    <input className="ui-input" type="search" value={draft} maxLength={maxLength} placeholder={placeholder}
      onChange={event => setDraft(event.currentTarget.value)} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
  </label>;
}
