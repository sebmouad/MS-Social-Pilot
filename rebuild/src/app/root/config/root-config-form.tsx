'use client';

import { useState } from 'react';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;

export function RootConfigForm({ definitions, initialValues, availability }: { definitions: Definition[]; initialValues: Values; availability: Catalog }) {
  const [values, setValues] = useState(initialValues);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const sections = Array.from(new Set(definitions.map((item) => item.group.split(' · ')[0])));
  const [section, setSection] = useState(sections[0] ?? '');
  const [search, setSearch] = useState('');
  const visible = definitions.filter((item) => {
    if (search.trim()) return `${item.label} ${item.key} ${item.description} ${item.group}`.toLowerCase().includes(search.trim().toLowerCase());
    return item.group.split(' · ')[0] === section;
  });

  async function save(key: string, value: unknown) {
    setMessage('Saving…');
    const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || 'Save failed.'); return; }
    setValues(result.values);
    setInputs((current) => ({ ...current, [key]: '' }));
    setMessage('Saved.');
  }

  async function clearSecret(key: string) {
    setMessage('Clearing…');
    const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value: '', clear: true }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || 'Clear failed.'); return; }
    setValues(result.values);
    setMessage('Saved secret cleared.');
  }

  return <div className="root-config__layout">
    <aside className="root-config__sidebar" aria-label="Root configuration sections">
      <label htmlFor="root-config-search">Find a setting</label>
      <input id="root-config-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" />
      <nav aria-label="Configuration categories">
        {sections.map((name) => <button key={name} type="button" className={!search && section === name ? 'is-active' : ''} aria-current={!search && section === name ? 'page' : undefined} onClick={() => { setSection(name); setSearch(''); }}>{name}</button>)}
      </nav>
    </aside>
    <div className="root-config__content">
    <div className="root-config__content-head"><h2>{search ? `Search results for “${search}”` : section}</h2><span>{visible.length} settings</span></div>
    {message && <p className="root-config__status" role="status" aria-live="polite">{message}</p>}
    {visible.length === 0 && <p className="root-config__empty">No matching settings.</p>}
    {visible.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      return <section className="root-config__card" key={definition.key}>
        <div className="root-config__group">{definition.group} · <code>{definition.key}</code></div>
        <h2>{definition.label}</h2>
        <p>{definition.description}</p>
        {definition.kind === 'boolean' ? <label><input type="checkbox" checked={Boolean(current?.value)} onChange={(event) => void save(definition.key, event.target.checked)} /> Enabled</label> : <div className="root-config__controls">
          {definition.kind === 'select' ? <select aria-label={definition.label} value={String(current?.value ?? definition.defaultValue)} onChange={(event) => void save(definition.key, event.target.value)}>
            {(definition.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : definition.kind === 'json' ? <textarea aria-label={definition.label} rows={4} value={inputs[definition.key] ?? JSON.stringify(current?.value ?? definition.defaultValue, null, 2)} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} /> : <input aria-label={definition.label} type={definition.kind === 'secret' ? 'password' : definition.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={definition.kind === 'secret' ? (current?.isSet ? 'Saved value hidden' : 'Enter secret') : undefined} value={inputs[definition.key] ?? (definition.kind === 'secret' ? '' : String(current?.value ?? definition.defaultValue))} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} />}
          {definition.kind !== 'select' && <button type="button" onClick={() => {
            let value: unknown = inputs[definition.key] ?? (definition.kind === 'secret' ? '' : current?.value ?? definition.defaultValue);
            if (definition.kind === 'number') value = Number(value);
            if (definition.kind === 'json') {
              try { value = JSON.parse(String(value)); }
              catch { setMessage(`${definition.label}: enter valid JSON.`); return; }
            }
            void save(definition.key, value);
          }}>Save</button>}
          {definition.kind === 'secret' && <button type="button" onClick={() => void clearSecret(definition.key)}>Clear saved secret</button>}
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
