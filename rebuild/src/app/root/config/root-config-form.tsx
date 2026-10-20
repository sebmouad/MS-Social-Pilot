'use client';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useRef, useState } from 'react';
import { SidebarDock } from '@/components/SidebarDock';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;

export function RootConfigForm({ definitions, initialValues, availability, groupPrefix, initialSearch = '' }: { definitions: Definition[]; initialValues: Values; availability: Catalog; groupPrefix?: string; initialSearch?: string }) {
  const [values, setValues] = useState(initialValues);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<Record<string, 'save' | 'clear'>>({});
  const inFlight = useRef(new Set<string>());
  const categoryFor = (item: Definition) => (groupPrefix && item.group.startsWith(`${groupPrefix} · `) ? item.group.slice(groupPrefix.length + 3) : item.group).split(' · ')[0];
  const sections = Array.from(new Set(definitions.map(categoryFor)));
  const [section, setSection] = useState(sections[0] ?? '');
  const [search, setSearch] = useState(initialSearch);
  const visible = definitions.filter((item) => {
    if (search.trim()) return `${item.label} ${item.key} ${item.description} ${item.group}`.toLowerCase().includes(search.trim().toLowerCase());
    return categoryFor(item) === section;
  });

  async function write(key: string, operation: 'save' | 'clear', value: unknown) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending((current) => ({ ...current, [key]: operation }));
    setMessage({ text: operation === 'save' ? 'Saving…' : 'Clearing…', error: false });
    try {
      const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value, ...(operation === 'clear' ? { clear: true } : {}) }) });
      const result = await response.json() as { error?: unknown; values?: unknown };
      if (!response.ok) {
        setMessage({ text: typeof result.error === 'string' && result.error ? result.error : `Could not ${operation === 'save' ? 'save' : 'clear'} this setting. Check your connection and try again.`, error: true });
        return;
      }
      if (!Array.isArray(result.values)) throw new Error('Invalid configuration response.');
      setValues(result.values as Values);
      if (operation === 'save') setInputs((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage({ text: operation === 'save' ? 'Saved.' : 'Saved secret cleared.', error: false });
    } catch {
      setMessage({ text: `Could not ${operation === 'save' ? 'save' : 'clear'} this setting. Check your connection and try again.`, error: true });
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
    <SidebarDock><aside className="root-config__sidebar" aria-label="Root configuration sections">
      <label htmlFor="root-config-search">Find a setting</label>
      <input id="root-config-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" />
      <nav aria-label="Configuration categories">
        {sections.map((name) => <button key={name} type="button" className={!search && section === name ? 'is-active' : ''} aria-current={!search && section === name ? 'page' : undefined} onClick={() => { setSection(name); setSearch(''); }}>{name}</button>)}
      </nav>
    </aside></SidebarDock>
    <div className="root-config__content">
    <div className="root-config__content-head"><h2>{search ? `Search results for “${search}”` : section}</h2><span>{visible.length} settings</span></div>
    {message && <p className="root-config__status" role={message.error ? 'alert' : 'status'} aria-live={message.error ? 'assertive' : 'polite'}>{message.text}</p>}
    {visible.length === 0 && <p className="root-config__empty">No matching settings.</p>}
    {visible.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      const isPending = Boolean(pending[definition.key]);
      return <section className="root-config__card" key={definition.key}>
        <div className="root-config__group">{definition.group} · <code>{definition.key}</code></div>
        <h2>{definition.label}</h2>
        <p>{definition.description}</p>
        {definition.kind === 'boolean' ? <label><input type="checkbox" aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} checked={Boolean(current?.value)} onChange={(event) => void write(definition.key, 'save', event.target.checked)} /> Enabled</label> : <div className="root-config__controls">
          {definition.kind === 'select' ? <select aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} value={String(current?.value ?? definition.defaultValue)} onChange={(event) => void write(definition.key, 'save', event.target.value)}>
            {(definition.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : definition.kind === 'json' ? <AutoTextarea aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} rows={4} value={inputs[definition.key] ?? JSON.stringify(current?.value ?? definition.defaultValue, null, 2)} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} /> : <input aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} type={definition.kind === 'secret' ? 'password' : definition.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={definition.kind === 'secret' ? (current?.isSet ? 'Saved value hidden' : 'Enter secret') : undefined} value={inputs[definition.key] ?? (definition.kind === 'secret' ? '' : String(current?.value ?? definition.defaultValue))} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} />}
          {definition.kind !== 'select' && <button type="button" disabled={isPending} aria-busy={pending[definition.key] === 'save' || undefined} onClick={() => {
            let value: unknown = inputs[definition.key] ?? (definition.kind === 'secret' ? '' : current?.value ?? definition.defaultValue);
            if (definition.kind === 'number') value = Number(value);
            if (definition.kind === 'json') {
              try { value = JSON.parse(String(value)); }
              catch { setMessage({ text: `${definition.label}: enter valid JSON.`, error: true }); return; }
            }
            void write(definition.key, 'save', value);
          }}>Save</button>}
          {definition.kind === 'secret' && <button type="button" disabled={isPending} aria-busy={pending[definition.key] === 'clear' || undefined} onClick={() => void write(definition.key, 'clear', '')}>Clear saved secret</button>}
        </div>}
        <small>Source: {current?.source ?? 'default'} · {definition.consumption === 'active' ? 'Active' : definition.consumption === 'configured' ? 'Stored; runtime wiring pending' : 'Stored; consumer not implemented'}{definition.kind === 'secret' && current?.isSet ? ' · saved value is concealed' : ''}</small>
      </section>;
    })}
    {!search && section === 'Entitlements' && <section className="root-config__catalog">
      <h2>Manifest inventory</h2>
      <p>These modules and features come from the product manifests. Changes apply to the next request and remain subject to workspace and plan access.</p>
      <h3>Modules</h3><ul>{availability.modules.map((module) => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
      <h3>Features</h3><ul>{availability.features.map((feature) => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
    </section>}
    </div>
  </div>;
}
