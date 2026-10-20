'use client';
import { ROOT_CONFIG_COPY, configCopyText, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useRef, useState } from 'react';
import { SidebarDock } from '@/components/SidebarDock';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;

export function RootConfigForm({ definitions, initialValues, availability, groupPrefix, initialSearch = '', groupByOwner = false, copy = ROOT_CONFIG_COPY }: { definitions: Definition[]; initialValues: Values; availability: Catalog; groupPrefix?: string; initialSearch?: string; groupByOwner?: boolean; copy?: RootConfigCopy }) {
  const [values, setValues] = useState(initialValues);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<Record<string, 'save' | 'clear'>>({});
  const inFlight = useRef(new Set<string>());
  const categoryName = (item: Definition) => (groupPrefix && item.group.startsWith(`${groupPrefix} · `) ? item.group.slice(groupPrefix.length + 3) : item.group).split(' · ')[0];
  const ownerName = (item: Definition) => item.owner.kind === 'shared' ? copy.shared : `${copy[item.owner.kind]} · ${item.owner.id}`;
  const categoryFor = (item: Definition) => groupByOwner ? `${ownerName(item)} · ${categoryName(item)}` : categoryName(item);
  const ownerOrder = { shared: 0, product: 1, platform: 2 };
  const ordered = groupByOwner ? [...definitions].sort((a, b) => ownerOrder[a.owner.kind] - ownerOrder[b.owner.kind] || ownerName(a).localeCompare(ownerName(b)) || categoryName(a).localeCompare(categoryName(b))) : definitions;
  const sections = Array.from(new Set(ordered.map(categoryFor)));
  const [section, setSection] = useState(sections[0] ?? '');
  const [search, setSearch] = useState(initialSearch);
  const visible = definitions.filter((item) => {
    if (search.trim()) return `${item.label} ${item.key} ${item.description} ${item.group} ${ownerName(item)}`.toLowerCase().includes(search.trim().toLowerCase());
    return categoryFor(item) === section;
  });

  async function write(key: string, operation: 'save' | 'clear', value: unknown) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending((current) => ({ ...current, [key]: operation }));
    setMessage({ text: operation === 'save' ? copy.saving : copy.clearing, error: false });
    try {
      const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value, ...(operation === 'clear' ? { clear: true } : {}) }) });
      const result = await response.json() as { error?: unknown; values?: unknown };
      if (!response.ok) {
        setMessage({ text: typeof result.error === 'string' && result.error ? result.error : (operation === 'save' ? copy.saveFailure : copy.clearFailure), error: true });
        return;
      }
      if (!Array.isArray(result.values)) throw new Error(copy.invalidResponse);
      setValues(result.values as Values);
      if (operation === 'save') setInputs((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage({ text: operation === 'save' ? copy.saved : copy.cleared, error: false });
    } catch {
      setMessage({ text: (operation === 'save' ? copy.saveFailure : copy.clearFailure), error: true });
    } finally {
      inFlight.current.delete(key);
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  return <div className="root-config__layout">
    <SidebarDock><aside className="root-config__sidebar" aria-label={copy.sectionsLabel}>
      <label htmlFor="root-config-search">{copy.find}</label>
      <input id="root-config-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} />
      <nav aria-label={copy.categoriesLabel}>
        {sections.map((name) => <button key={name} type="button" className={!search && section === name ? 'is-active' : ''} aria-current={!search && section === name ? 'page' : undefined} onClick={() => { setSection(name); setSearch(''); }}>{name}</button>)}
      </nav>
    </aside></SidebarDock>
    <div className="root-config__content">
    <div className="root-config__content-head"><h2>{search ? configCopyText(copy.searchResults, { search }) : section}</h2><span>{configCopyText(copy.count, { count: visible.length })}</span></div>
    {message && <p className="root-config__status" role={message.error ? 'alert' : 'status'} aria-live={message.error ? 'assertive' : 'polite'}>{message.text}</p>}
    {visible.length === 0 && <p className="root-config__empty">{copy.empty}</p>}
    {visible.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      const isPending = Boolean(pending[definition.key]);
      return <section className="root-config__card" key={definition.key}>
        <div className="root-config__group">{groupByOwner ? `${ownerName(definition)} · ` : ''}{definition.group} · <code>{definition.key}</code></div>
        <h2>{definition.label}</h2>
        <p>{definition.description}</p>
        {definition.kind === 'boolean' ? <label><input type="checkbox" aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} checked={Boolean(current?.value)} onChange={(event) => void write(definition.key, 'save', event.target.checked)} /> {copy.enabled}</label> : <div className="root-config__controls">
          {definition.kind === 'select' ? <select aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} value={String(current?.value ?? definition.defaultValue)} onChange={(event) => void write(definition.key, 'save', event.target.value)}>
            {(definition.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : definition.kind === 'json' ? <AutoTextarea aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} rows={4} value={inputs[definition.key] ?? JSON.stringify(current?.value ?? definition.defaultValue, null, 2)} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} /> : <input aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} type={definition.kind === 'secret' ? 'password' : definition.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={definition.kind === 'secret' ? (current?.isSet ? copy.hidden : copy.enterSecret) : undefined} value={inputs[definition.key] ?? (definition.kind === 'secret' ? '' : String(current?.value ?? definition.defaultValue))} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} />}
          {definition.kind !== 'select' && <button type="button" disabled={isPending} aria-busy={pending[definition.key] === 'save' || undefined} onClick={() => {
            let value: unknown = inputs[definition.key] ?? (definition.kind === 'secret' ? '' : current?.value ?? definition.defaultValue);
            if (definition.kind === 'number') value = Number(value);
            if (definition.kind === 'json') {
              try { value = JSON.parse(String(value)); }
              catch { setMessage({ text: configCopyText(copy.invalidJson, { label: definition.label }), error: true }); return; }
            }
            void write(definition.key, 'save', value);
          }}>{copy.save}</button>}
          {definition.kind === 'secret' && <button type="button" disabled={isPending} aria-busy={pending[definition.key] === 'clear' || undefined} onClick={() => void write(definition.key, 'clear', '')}>{copy.clearSecret}</button>}
        </div>}
        <small>{copy.source} {current?.source === 'database' ? copy.databaseSource : copy.defaultSource} · {definition.consumption === 'active' ? copy.active : definition.consumption === 'configured' ? copy.configured : copy.planned}{definition.kind === 'secret' && current?.isSet ? ` · ${copy.concealed}` : ''}</small>
      </section>;
    })}
    {!search && visible.some(item => item.key.startsWith('entitlements.')) && <section className="root-config__catalog">
      <h2>{copy.inventory}</h2>
      <p>{copy.inventoryDescription}</p>
      <h3>{copy.modules}</h3><ul>{availability.modules.map((module) => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
      <h3>{copy.features}</h3><ul>{availability.features.map((feature) => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
    </section>}
    </div>
  </div>;
}
