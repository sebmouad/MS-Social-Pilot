'use client';

import { useState } from 'react';
import styles from '../settings.module.css';

type Member = { id: string; userId: string; name: string; email: string; role: string; targetIds: string[]; allPages: boolean };
type Target = { id: string; name: string; type: string };
const roles = ['admin', 'editor', 'contributor', 'viewer', 'client'];

export function TeamControls({ members, targets, actorId, actorRole }: { members: Member[]; targets: Target[]; actorId: string; actorRole: string }) {
  const [rows, setRows] = useState(members);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [allPages, setAllPages] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/team', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'The team change failed.');
      setNotice('Team access updated.'); window.location.reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The team change failed.'); }
    finally { setBusy(false); }
  }

  function scopeChoices(value: string[], all: boolean, onChange: (ids: string[], allPages: boolean) => void) {
    return <fieldset className={styles['team-channels']}><legend>Channel access</legend><label><input type="checkbox" checked={all} onChange={event => onChange(value, event.currentTarget.checked)} /> All channels</label>{targets.map(target => <label key={target.id}><input type="checkbox" checked={!all && value.includes(target.id)} disabled={all} onChange={event => onChange(event.currentTarget.checked ? [...value, target.id] : value.filter(id => id !== target.id), false)} /> {target.name} <small>{target.type}</small></label>)}</fieldset>;
  }

  return <div className={styles['team-management']}>
    <form method="post" className={styles['team-add-form']} onSubmit={event => { event.preventDefault(); void mutate('POST', { email, role, targetIds: allPages ? [] : selected, allPages }); }}>
      <h3>Add an existing account</h3><p>They must already have an active account. New account invitations are unavailable until email invitations are configured.</p>
      <div className={styles['team-add-fields']}><label>Email address<input type="email" value={email} onChange={event => setEmail(event.currentTarget.value)} required maxLength={320} /></label><label>Role<select value={role} onChange={event => setRole(event.currentTarget.value)}>{actorRole === 'owner' && <option value="owner">owner</option>}{roles.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
      <label className={styles['team-all-channels']}><input type="checkbox" checked={allPages} onChange={event => setAllPages(event.currentTarget.checked)} /> Access to all channels</label>
      {!allPages && <div className={styles['team-channel-list']}>{targets.map(target => <label key={target.id}><input type="checkbox" checked={selected.includes(target.id)} onChange={event => setSelected(event.currentTarget.checked ? [...selected, target.id] : selected.filter(id => id !== target.id))} /> {target.name}</label>)}</div>}
      <button disabled={busy}>{busy ? 'Saving…' : 'Add member'}</button>
    </form>
    <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>Person</th><th>Email</th><th>Role and channels</th><th>Actions</th></tr></thead><tbody>
      {rows.map(member => <MemberRow key={member.id} member={member} targets={targets} actorId={actorId} actorRole={actorRole} disabled={busy} onSave={(nextRole, ids, all) => void mutate('PATCH', { membershipId: member.id, role: nextRole, targetIds: ids, allPages: all })} onRemove={() => void mutate('DELETE', { membershipId: member.id })} scopeChoices={scopeChoices} />)}
    </tbody></table></div>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
  </div>;
}

function MemberRow({ member, actorId, actorRole, disabled, onSave, onRemove, scopeChoices }: { member: Member; targets: Target[]; actorId: string; actorRole: string; disabled: boolean; onSave: (role: string, ids: string[], all: boolean) => void; onRemove: () => void; scopeChoices: (ids: string[], all: boolean, onChange: (ids: string[], allPages: boolean) => void) => React.ReactNode }) {
  const [role, setRole] = useState(member.role);
  const [ids, setIds] = useState(member.allPages ? [] : member.targetIds);
  const [all, setAll] = useState(member.allPages);
  const [editing, setEditing] = useState(false);
  const self = member.userId === actorId;
  return <tr><td><span className={styles['settings-table__primary']}>{member.name}{self ? ' (you)' : ''}</span></td><td>{member.email}</td><td><span className={styles['settings-chip']}>{member.role}</span>{editing && <div className={styles['team-row-edit']}><select value={role} onChange={event => setRole(event.currentTarget.value)} disabled={self || (member.role === 'owner' && actorRole !== 'owner')}>{(member.role === 'owner' || actorRole === 'owner') && <option value="owner">owner</option>}{roles.map(item => <option key={item}>{item}</option>)}</select>{scopeChoices(ids, all, (nextIds, nextAll) => { setIds(nextIds); setAll(nextAll); })}</div>}</td><td><div className={styles['team-row-actions']}><button type="button" disabled={disabled} onClick={() => editing ? (onSave(role, ids, all), setEditing(false)) : setEditing(true)}>{editing ? 'Save' : 'Edit'}</button>{editing && <button type="button" disabled={disabled} onClick={() => setEditing(false)}>Cancel</button>}{!self && <button type="button" disabled={disabled || (member.role === 'owner' && actorRole !== 'owner')} onClick={onRemove}>Remove</button>}</div></td></tr>;
}
