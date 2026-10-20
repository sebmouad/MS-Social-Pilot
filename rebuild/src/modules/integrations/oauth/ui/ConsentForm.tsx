'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import styles from '@/modules/settings/ui/settings.module.css';
import type { OAuthCopyKey } from '../copy';

type Feature = { id: string; name: string; canWrite: boolean };
type Resource = { id: string; name: string };
type Hidden = Record<'client_id' | 'redirect_uri' | 'response_type' | 'code_challenge' | 'code_challenge_method' | 'state' | 'scope' | 'workspace_id', string>;

const fill = (text: string, vars: Record<string, string>) => Object.entries(vars).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), text);

/**
 * Consent controls. Narrowest by default: reading only, selected resources with none ticked. The server re-validates every
 * field; the confirmation dialog (the shared useConfirm dialog, not a native one) is only an extra check before wider grants.
 */
export function ConsentForm({ copy, hidden, features, channels, adAccounts, canAll, truncated, client, workspace }: {
  copy: Record<OAuthCopyKey, string>; hidden: Hidden; features: Feature[]; channels: Resource[]; adAccounts: Resource[]; canAll: boolean; truncated: boolean; client: string; workspace: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const decision = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<string[]>(features.map(feature => feature.id));
  const [write, setWrite] = useState<string[]>([]);
  const [mode, setMode] = useState<'selected' | 'all'>('selected');
  const [targets, setTargets] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm({ title: copy.confirmTitle, cancel: copy.confirmCancel, confirm: copy.confirmAllow });
  const toggle = (list: string[], set: (value: string[]) => void, id: string, on: boolean) => set(on ? [...new Set([...list, id])] : list.filter(item => item !== id));

  async function allow() {
    setError('');
    if (!read.length) return setError(copy.chooseRead);
    if (mode === 'selected' && !targets.length && !accounts.length) return setError(copy.chooseOne);
    const writes = write.length > 0; const everything = mode === 'all';
    if (writes || everything) {
      const text = fill(writes && everything ? copy.confirmBoth : writes ? copy.confirmWrite : copy.confirmAll, { client, workspace });
      if (!(await confirm(text))) return;
    }
    if (decision.current) decision.current.value = 'allow';
    form.current?.requestSubmit();
  }

  return <form ref={form} method="post" action="/api/oauth/authorize" className={styles['mcp-key-form']}>
    {(Object.keys(hidden) as Array<keyof Hidden>).map(key => <input key={key} type="hidden" name={key} value={hidden[key]} />)}
    <input ref={decision} type="hidden" name="decision" defaultValue="deny" />
    <input type="hidden" name="mode" value={mode} />
    <section className={styles['settings-panel']} aria-labelledby="oauth-features">
      <div className={styles['settings-panel__heading']}><div><h2 id="oauth-features">{copy.featuresTitle}</h2><p>{copy.featuresDetail}</p></div></div>
      <div className={styles['settings-table-wrap']}>
        <table className={styles['settings-table']}>
          <thead><tr><th scope="col">{copy.colFeature}</th><th scope="col">{copy.colRead}</th><th scope="col">{copy.colWrite}</th></tr></thead>
          <tbody>{features.map(feature => <tr key={feature.id}>
            <th scope="row"><span className={styles['settings-table__primary']}>{feature.name}</span></th>
            <td><input type="checkbox" name="read" value={feature.id} checked={read.includes(feature.id)} aria-label={`${copy.colRead}: ${feature.name}`}
              onChange={event => { toggle(read, setRead, feature.id, event.target.checked); if (!event.target.checked) setWrite(write.filter(item => item !== feature.id)); }} /></td>
            <td>{feature.canWrite ? <input type="checkbox" name="write" value={feature.id} checked={write.includes(feature.id)} disabled={!read.includes(feature.id)} aria-label={`${copy.colWrite}: ${feature.name}`}
              onChange={event => toggle(write, setWrite, feature.id, event.target.checked)} /> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className={styles['settings-panel']} aria-labelledby="oauth-resources">
      <div className={styles['settings-panel__heading']}><div><h2 id="oauth-resources">{copy.channelsTitle}</h2></div></div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <label><input type="radio" name="mode_choice" checked={mode === 'selected'} onChange={() => setMode('selected')} /> {copy.modeSelected}</label>
        {canAll ? <label style={{ display: 'block' }}><input type="radio" name="mode_choice" checked={mode === 'all'} onChange={() => setMode('all')} /> {copy.modeAll}</label> : null}
      </fieldset>
      {mode === 'selected' ? truncated ? <p role="alert">{copy.tooMany}</p> : !channels.length && !adAccounts.length ? <p>{copy.noResources}</p> : <>
        {channels.length ? <fieldset style={{ border: 0, padding: 0 }}><legend>{copy.channels}</legend>{channels.map(item => <label key={item.id} style={{ display: 'block' }}>
          <input type="checkbox" name="target" value={item.id} checked={targets.includes(item.id)} onChange={event => toggle(targets, setTargets, item.id, event.target.checked)} /> {item.name}</label>)}</fieldset> : null}
        {adAccounts.length ? <fieldset style={{ border: 0, padding: 0 }}><legend>{copy.adAccounts}</legend>{adAccounts.map(item => <label key={item.id} style={{ display: 'block' }}>
          <input type="checkbox" name="adAccount" value={item.id} checked={accounts.includes(item.id)} onChange={event => toggle(accounts, setAccounts, item.id, event.target.checked)} /> {item.name}</label>)}</fieldset> : null}
      </> : null}
    </section>
    <p className={styles['settings-note']}>{fill(copy.revokeHint, { client })}</p>
    {error ? <p role="alert" className={styles['settings-note']}>{error}</p> : null}
    <div className={styles['settings-row-actions']}>
      <Button type="submit" onClick={() => { if (decision.current) decision.current.value = 'deny'; }}>{copy.deny}</Button>
      <Button type="button" variant="primary" onClick={() => void allow()} disabled={truncated && mode === 'selected'}>{copy.allow}</Button>
    </div>
    {dialog}
  </form>;
}
